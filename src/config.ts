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
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  dynamoOwnersTable: string;
  dynamoSessionsTable: string;
  dynamoBusinessesTable: string;
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
    twilioAccountSid: env.TWILIO_ACCOUNT_SID ?? "",
    twilioAuthToken: env.TWILIO_AUTH_TOKEN ?? "",
    twilioFromNumber: env.TWILIO_FROM_NUMBER ?? "",
    dynamoOwnersTable: env.DYNAMODB_OWNERS_TABLE ?? "",
    dynamoSessionsTable: env.DYNAMODB_SESSIONS_TABLE ?? "",
    dynamoBusinessesTable: env.DYNAMODB_BUSINESSES_TABLE ?? "",
  };
}

/** Owner-login (DynamoDB) is entirely optional: the dashboard works exactly as before (unauthenticated, or gated by the single-shared DASHBOARD_TOKEN) until both tables are configured. */
export function ownerAuthConfigured(config: Config): boolean {
  return Boolean(config.dynamoOwnersTable && config.dynamoSessionsTable);
}

/** Business directory (DynamoDB) is entirely optional: without it, find_businesses and the dashboard only ever see the seeded demo businesses. */
export function businessDirectoryConfigured(config: Config): boolean {
  return Boolean(config.dynamoBusinessesTable);
}
