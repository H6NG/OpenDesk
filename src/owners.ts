import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { Config } from "./config.js";
import type { Owner, OwnerRole, OwnerSession } from "./types.js";

const VALID_ROLES: OwnerRole[] = ["owner", "manager", "employee"];

const scryptAsync = promisify(scrypt);

export class OwnerAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerAuthError";
  }
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Node's documented scrypt password-hashing recipe: random salt, "saltHex:hashHex" at rest. */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hashHex, "hex");
  return derived.length === storedBuf.length && timingSafeEqual(derived, storedBuf);
}

// Minimal shape of what we call on the client, so a test can inject a stub
// instead of a real DynamoDBDocumentClient — same pattern as setBedrockClient/setSmsClient.
type MinimalDynamoClient = {
  send: (command: GetCommand | PutCommand | DeleteCommand) => Promise<{ Item?: Record<string, unknown> }>;
};

let client: MinimalDynamoClient | null = null;

/** Lets tests (and other callers) inject a stub instead of a real AWS client. */
export function setDynamoClient(c: MinimalDynamoClient | null): void {
  client = c;
}

function getClient(region: string): MinimalDynamoClient {
  if (!client) client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  return client;
}

export async function signUpOwner(
  config: Config,
  params: { email: string; password: string; businessId: string; role?: OwnerRole },
): Promise<Owner> {
  const email = params.email.trim().toLowerCase();
  if (!email || !params.password || !params.businessId) {
    throw new OwnerAuthError("Email, password, and business are required.");
  }
  if (params.password.length < 8) {
    throw new OwnerAuthError("Password must be at least 8 characters.");
  }
  const role = params.role ?? "owner";
  if (!VALID_ROLES.includes(role)) {
    throw new OwnerAuthError("Role must be owner, manager, or employee.");
  }
  const c = getClient(config.awsRegion);
  const existing = await c.send(new GetCommand({ TableName: config.dynamoOwnersTable, Key: { email } }));
  if (existing.Item) {
    throw new OwnerAuthError("An account with that email already exists.");
  }
  const owner: Owner = {
    id: randomUUID(),
    email,
    passwordHash: await hashPassword(params.password),
    businessId: params.businessId,
    role,
    createdAt: new Date().toISOString(),
  };
  await c.send(new PutCommand({ TableName: config.dynamoOwnersTable, Item: owner }));
  return owner;
}

export interface LoginResult {
  owner: Owner;
  token: string;
  expiresAt: string;
}

export async function loginOwner(config: Config, email: string, password: string): Promise<LoginResult> {
  const c = getClient(config.awsRegion);
  const result = await c.send(new GetCommand({ TableName: config.dynamoOwnersTable, Key: { email: email.trim().toLowerCase() } }));
  const owner = result.Item as Owner | undefined;
  if (!owner || !(await verifyPassword(password, owner.passwordHash))) {
    throw new OwnerAuthError("Incorrect email or password.");
  }

  const token = base64url(randomBytes(32));
  const nowMs = Date.now();
  const expiresAtMs = nowMs + SESSION_TTL_MS;
  const session: OwnerSession = {
    tokenHash: sha256Hex(token),
    ownerId: owner.id,
    businessId: owner.businessId,
    role: owner.role,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttl: Math.floor(expiresAtMs / 1000),
  };
  await c.send(new PutCommand({ TableName: config.dynamoSessionsTable, Item: session }));

  return { owner, token, expiresAt: session.expiresAt };
}

export interface SessionIdentity {
  ownerId: string;
  businessId: string;
  role: OwnerRole;
}

/** Null for a missing, unknown, or expired session — callers should treat all three identically (redirect to /login). */
export async function getSessionOwner(config: Config, token: string | undefined): Promise<SessionIdentity | null> {
  if (!token) return null;
  const c = getClient(config.awsRegion);
  const result = await c.send(new GetCommand({ TableName: config.dynamoSessionsTable, Key: { tokenHash: sha256Hex(token) } }));
  const session = result.Item as OwnerSession | undefined;
  if (!session) return null;
  // Belt-and-suspenders: DynamoDB's TTL cleanup isn't instantaneous, so an
  // expired-but-not-yet-deleted item must still be rejected here.
  if (Date.parse(session.expiresAt) <= Date.now()) return null;
  return { ownerId: session.ownerId, businessId: session.businessId, role: session.role ?? "owner" };
}

export async function logoutOwner(config: Config, token: string | undefined): Promise<void> {
  if (!token) return;
  const c = getClient(config.awsRegion);
  await c.send(new DeleteCommand({ TableName: config.dynamoSessionsTable, Key: { tokenHash: sha256Hex(token) } }));
}
