import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Config } from "./config.js";
import type { Business } from "./types.js";
import type { Store } from "./store.js";

// Minimal shape of what we call on the client, so a test can inject a stub
// instead of a real DynamoDBDocumentClient — same pattern as setBedrockClient/setDynamoClient.
type MinimalDynamoClient = {
  send: (command: PutCommand | ScanCommand) => Promise<{ Items?: Record<string, unknown>[] }>;
};

let client: MinimalDynamoClient | null = null;

/** Lets tests (and other callers) inject a stub instead of a real AWS client. */
export function setBusinessDynamoClient(c: MinimalDynamoClient | null): void {
  client = c;
}

function getClient(region: string): MinimalDynamoClient {
  if (!client) client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  return client;
}

/** Persists one business as a single item, keyed by id. Overwrites any existing row with the same id. */
export async function putBusiness(config: Config, business: Business): Promise<void> {
  const c = getClient(config.awsRegion);
  await c.send(new PutCommand({ TableName: config.dynamoBusinessesTable, Item: business }));
}

/** Full table scan — fine at hackathon-demo scale (dozens of rows), not meant to scale past that. */
export async function listBusinesses(config: Config): Promise<Business[]> {
  const c = getClient(config.awsRegion);
  const result = await c.send(new ScanCommand({ TableName: config.dynamoBusinessesTable }));
  return (result.Items ?? []) as unknown as Business[];
}

/**
 * Overlays any DynamoDB-stored businesses onto the in-memory store at startup, so businesses
 * published on a previous run (or by another instance) survive a restart. Dynamo wins on id
 * collision; everything else (appointments, customers, etc.) is unaffected and stays in-memory/JSON.
 */
export async function loadBusinessesIntoStore(config: Config, store: Store): Promise<void> {
  const dynamoBusinesses = await listBusinesses(config);
  for (const business of dynamoBusinesses) {
    const idx = store.data.businesses.findIndex((b) => b.id === business.id);
    if (idx === -1) store.data.businesses.push(business);
    else store.data.businesses[idx] = business;
  }
}
