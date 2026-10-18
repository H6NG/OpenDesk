import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type express from "express";
import { now } from "./clock.js";
import type { Store } from "./store.js";
import type { Config } from "./config.js";
import type { OAuthCode, OAuthToken } from "./types.js";

const CODE_TTL_MS = 10 * 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60_000;
const SCOPES_SUPPORTED = ["appointments"];

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string {
  return base64url(randomBytes(32));
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function sha256Base64Url(input: string): string {
  return base64url(createHash("sha256").update(input).digest());
}

function resourceUrl(config: Config): string {
  return `${config.publicUrl.replace(/\/$/, "")}/mcp`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function registerOAuthRoutes(app: express.Express, config: Config, store: Store): void {
  const resource = resourceUrl(config);
  const issuer = config.publicUrl.replace(/\/$/, "");

  const protectedResourceMetadata = {
    resource,
    authorization_servers: [issuer],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
  };
  app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(protectedResourceMetadata));
  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(protectedResourceMetadata));

  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
      scopes_supported: SCOPES_SUPPORTED,
    });
  });

  function renderLoginForm(params: Record<string, string>, error?: string): string {
    const hidden = Object.entries(params)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join("\n      ");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Link your account - Front Desk</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; background: #eef2f0; color: #1b2a41; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  form { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); width: 320px; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  label { display: block; font-size: 0.875rem; margin: 0.75rem 0 0.25rem; }
  input[type=text], input[type=tel] { width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
  button { margin-top: 1.25rem; width: 100%; padding: 0.6rem; border: none; border-radius: 6px; background: #0e7c86; color: #fff; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; font-size: 0.875rem; margin-top: 0.5rem; }
</style>
</head>
<body>
  <form method="post" action="/oauth/authorize">
    <h1>Link your account to Front Desk</h1>
    <label for="name">Name</label>
    <input type="text" id="name" name="name" required>
    <label for="phone">Phone number</label>
    <input type="tel" id="phone" name="phone" required>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    ${hidden}
    <button type="submit">Continue</button>
  </form>
</body>
</html>`;
  }

  interface AuthorizeParams {
    responseType: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    resource: string;
    state: string;
  }

  function parseAuthorizeParams(q: Record<string, unknown>): AuthorizeParams {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      responseType: str(q.response_type),
      clientId: str(q.client_id),
      redirectUri: str(q.redirect_uri),
      codeChallenge: str(q.code_challenge),
      codeChallengeMethod: str(q.code_challenge_method),
      scope: str(q.scope) || SCOPES_SUPPORTED[0],
      resource: str(q.resource),
      state: str(q.state),
    };
  }

  function redirectAllowed(redirectUri: string): boolean {
    if (config.oauthAllowAnyRedirect) return true;
    return config.oauthRedirectUris.includes(redirectUri);
  }

  function errorRedirect(res: express.Response, redirectUri: string, state: string, error: string, description: string) {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    res.redirect(url.toString());
  }

  function handleAuthorize(req: express.Request, res: express.Response) {
    const p = parseAuthorizeParams(req.method === "GET" ? req.query : req.body);

    // client_id and redirect_uri must be valid BEFORE we trust redirect_uri with error responses.
    if (p.clientId !== config.oauthClientId) {
      res.status(400).send("Unknown client_id.");
      return;
    }
    if (!p.redirectUri || !redirectAllowed(p.redirectUri)) {
      res.status(400).send("Unregistered redirect_uri.");
      return;
    }

    if (p.responseType !== "code") {
      return errorRedirect(res, p.redirectUri, p.state, "unsupported_response_type", "Only 'code' is supported.");
    }
    if (p.resource !== resource) {
      return errorRedirect(res, p.redirectUri, p.state, "invalid_target", `resource must be ${resource}`);
    }
    if (p.codeChallengeMethod !== "S256" || !p.codeChallenge) {
      return errorRedirect(res, p.redirectUri, p.state, "invalid_request", "PKCE with S256 is required.");
    }
    if (!SCOPES_SUPPORTED.includes(p.scope)) {
      return errorRedirect(res, p.redirectUri, p.state, "invalid_scope", `scope must be one of ${SCOPES_SUPPORTED.join(", ")}`);
    }

    if (req.method === "GET") {
      res.set("Content-Type", "text/html").send(
        renderLoginForm({
          response_type: p.responseType,
          client_id: p.clientId,
          redirect_uri: p.redirectUri,
          code_challenge: p.codeChallenge,
          code_challenge_method: p.codeChallengeMethod,
          scope: p.scope,
          resource: p.resource,
          state: p.state,
        }),
      );
      return;
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
    if (!name || !phone) {
      res.set("Content-Type", "text/html").status(400).send(
        renderLoginForm(
          {
            response_type: p.responseType,
            client_id: p.clientId,
            redirect_uri: p.redirectUri,
            code_challenge: p.codeChallenge,
            code_challenge_method: p.codeChallengeMethod,
            scope: p.scope,
            resource: p.resource,
            state: p.state,
          },
          "Please enter both your name and phone number.",
        ),
      );
      return;
    }

    const customer = store.upsertCustomerByPhone(name, phone);
    const nowMs = now().toMillis();
    const code: OAuthCode = {
      code: randomToken(),
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      codeChallengeMethod: "S256",
      scope: p.scope,
      resource: p.resource,
      customerId: customer.id,
      expiresAt: new Date(nowMs + CODE_TTL_MS).toISOString(),
      usedAt: null,
      createdAt: new Date(nowMs).toISOString(),
    };
    store.data.oauthCodes.push(code);
    store.touch();
    store.addEvent("", "account_linked", `${customer.name} linked their account`);

    const url = new URL(p.redirectUri);
    url.searchParams.set("code", code.code);
    if (p.state) url.searchParams.set("state", p.state);
    res.redirect(url.toString());
  }

  app.get("/oauth/authorize", handleAuthorize);
  app.post("/oauth/authorize", handleAuthorize);

  function authenticateClient(req: express.Request): { ok: true } | { ok: false; status: number; error: string } {
    let clientId = typeof req.body.client_id === "string" ? req.body.client_id : "";
    let clientSecret = typeof req.body.client_secret === "string" ? req.body.client_secret : "";

    const authHeader = req.get("authorization");
    if (authHeader?.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
        const idx = decoded.indexOf(":");
        if (idx >= 0) {
          clientId = decoded.slice(0, idx);
          clientSecret = decoded.slice(idx + 1);
        }
      } catch {
        return { ok: false, status: 401, error: "invalid_client" };
      }
    }

    if (clientId !== config.oauthClientId) return { ok: false, status: 401, error: "invalid_client" };
    if (config.oauthClientSecret) {
      if (!clientSecret || !timingSafeEqualStr(clientSecret, config.oauthClientSecret)) {
        return { ok: false, status: 401, error: "invalid_client" };
      }
    }
    return { ok: true };
  }

  function issueTokenPair(clientId: string, customerId: string, scope: string, nowMs: number): { access_token: string; refresh_token: string } {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const nowIso = new Date(nowMs).toISOString();

    const accessRecord: OAuthToken = {
      tokenHash: sha256Hex(accessToken),
      kind: "access",
      clientId,
      customerId,
      scope,
      expiresAt: new Date(nowMs + ACCESS_TOKEN_TTL_MS).toISOString(),
      createdAt: nowIso,
      revokedAt: null,
    };
    const refreshRecord: OAuthToken = {
      tokenHash: sha256Hex(refreshToken),
      kind: "refresh",
      clientId,
      customerId,
      scope,
      expiresAt: new Date(nowMs + REFRESH_TOKEN_TTL_MS).toISOString(),
      createdAt: nowIso,
      revokedAt: null,
    };
    store.data.oauthTokens.push(accessRecord, refreshRecord);
    store.touch();
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  app.post("/oauth/token", (req, res) => {
    const auth = authenticateClient(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const grantType = typeof req.body.grant_type === "string" ? req.body.grant_type : "";
    const nowMs = now().toMillis();

    if (grantType === "authorization_code") {
      const codeStr = typeof req.body.code === "string" ? req.body.code : "";
      const codeVerifier = typeof req.body.code_verifier === "string" ? req.body.code_verifier : "";
      const reqResource = typeof req.body.resource === "string" ? req.body.resource : "";
      const redirectUri = typeof req.body.redirect_uri === "string" ? req.body.redirect_uri : "";

      const record = store.data.oauthCodes.find((c) => c.code === codeStr);
      if (!record || record.usedAt || Date.parse(record.expiresAt) <= nowMs) {
        res.status(400).json({ error: "invalid_grant", error_description: "Unknown, used, or expired code." });
        return;
      }
      if (record.clientId !== config.oauthClientId || record.redirectUri !== redirectUri) {
        res.status(400).json({ error: "invalid_grant", error_description: "Client or redirect_uri mismatch." });
        return;
      }
      if (reqResource !== resource || reqResource !== record.resource) {
        res.status(400).json({ error: "invalid_target", error_description: `resource must be ${resource}` });
        return;
      }
      if (!codeVerifier || sha256Base64Url(codeVerifier) !== record.codeChallenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed." });
        return;
      }

      record.usedAt = new Date(nowMs).toISOString();
      store.touch();

      const tokens = issueTokenPair(record.clientId, record.customerId, record.scope, nowMs);
      res.json({ ...tokens, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000, scope: record.scope });
      return;
    }

    if (grantType === "refresh_token") {
      const refreshToken = typeof req.body.refresh_token === "string" ? req.body.refresh_token : "";
      const hash = sha256Hex(refreshToken);
      const record = store.data.oauthTokens.find((t) => t.tokenHash === hash && t.kind === "refresh");
      if (!record || record.revokedAt || Date.parse(record.expiresAt) <= nowMs || record.clientId !== config.oauthClientId) {
        res.status(400).json({ error: "invalid_grant", error_description: "Unknown, revoked, or expired refresh token." });
        return;
      }

      const tokens = issueTokenPair(record.clientId, record.customerId, record.scope, nowMs);
      record.revokedAt = new Date(nowMs).toISOString();
      record.rotatedToHash = sha256Hex(tokens.refresh_token);
      store.touch();

      res.json({ ...tokens, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000, scope: record.scope });
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  });
}

/**
 * Custom bearer check for POST /mcp when AUTH_MODE=oauth. Deliberately does
 * NOT set WWW-Authenticate on 401 (the SDK's bearer middleware does, which
 * this spec requires us to avoid), and only reads the Authorization header
 * -- never a query-string token.
 */
export function bearerAuthMiddleware(store: Store) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.get("authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const token = header.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const hash = sha256Hex(token);
    const nowMs = now().toMillis();
    const record = store.data.oauthTokens.find((t) => t.tokenHash === hash && t.kind === "access");
    if (!record || record.revokedAt || Date.parse(record.expiresAt) <= nowMs) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as express.Request & { customerId?: string }).customerId = record.customerId;
    next();
  };
}
