export type AuthMode = "none" | "oauth";

export interface Config {
  port: number;
  publicUrl: string;
  authMode: AuthMode;
  oauthClientId: string;
  oauthClientSecret: string | null;
  oauthRedirectUris: string[];
  oauthAllowAnyRedirect: boolean;
  dataFile: string;
  dashboardToken: string | null;
  awsRegion: string;
  bedrockModelId: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode = env.AUTH_MODE === "oauth" ? "oauth" : "none";
  return {
    port: Number(env.PORT ?? 3000),
    publicUrl: env.PUBLIC_URL ?? `http://localhost:${Number(env.PORT ?? 3000)}`,
    authMode,
    oauthClientId: env.OAUTH_CLIENT_ID ?? "",
    oauthClientSecret: env.OAUTH_CLIENT_SECRET || null,
    oauthRedirectUris: (env.OAUTH_REDIRECT_URIS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    oauthAllowAnyRedirect: env.OAUTH_ALLOW_ANY_REDIRECT === "true",
    dataFile: env.DATA_FILE ?? "data/store.json",
    dashboardToken: env.DASHBOARD_TOKEN || null,
    awsRegion: env.AWS_REGION ?? "us-east-1",
    bedrockModelId: env.BEDROCK_MODEL_ID ?? "us.amazon.nova-lite-v1:0",
  };
}
