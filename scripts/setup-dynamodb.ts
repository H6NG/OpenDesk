/**
 * One-time setup for the owner-login feature's two DynamoDB tables. Run this
 * yourself, once, with your own AWS credentials already configured (e.g. via
 * `aws configure`) — nothing in the app itself ever creates/deletes tables.
 *
 * Usage:
 *   DYNAMODB_OWNERS_TABLE=opendesk-owners \
 *   DYNAMODB_SESSIONS_TABLE=opendesk-sessions \
 *   AWS_REGION=us-east-1 \
 *   npx tsx scripts/setup-dynamodb.ts
 *
 * Safe to re-run: an existing table is detected and left alone.
 *
 * Capacity is deliberately small (5 RCU / 5 WCU per table, 10/10 total across
 * both) to stay well within DynamoDB's always-free 25 RCU / 25 WCU allowance
 * — this is provisioned-mode specifically so that allowance applies; see
 * PROGRESS_DEV.md for the cost reasoning.
 */
import { DynamoDBClient, CreateTableCommand, UpdateTimeToLiveCommand, ResourceInUseException, waitUntilTableExists } from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION ?? "us-east-1";
const ownersTable = process.env.DYNAMODB_OWNERS_TABLE;
const sessionsTable = process.env.DYNAMODB_SESSIONS_TABLE;

if (!ownersTable || !sessionsTable) {
  console.error("Set DYNAMODB_OWNERS_TABLE and DYNAMODB_SESSIONS_TABLE before running this script.");
  process.exit(1);
}

const client = new DynamoDBClient({ region });

async function createTableIfMissing(tableName: string, keyAttribute: string): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [{ AttributeName: keyAttribute, AttributeType: "S" }],
        KeySchema: [{ AttributeName: keyAttribute, KeyType: "HASH" }],
        BillingMode: "PROVISIONED",
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      }),
    );
    console.log(`Creating ${tableName}, waiting for it to become active...`);
    await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: tableName });
    console.log(`${tableName} is active.`);
  } catch (e) {
    if (e instanceof ResourceInUseException) {
      console.log(`${tableName} already exists — leaving it alone.`);
      return;
    }
    throw e;
  }
}

async function main(): Promise<void> {
  await createTableIfMissing(ownersTable!, "email");
  await createTableIfMissing(sessionsTable!, "tokenHash");

  // Expired sessions clean themselves up via DynamoDB's native TTL, keyed on
  // the epoch-seconds `ttl` attribute owners.ts already writes on every session.
  try {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: sessionsTable,
        TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      }),
    );
    console.log(`TTL enabled on ${sessionsTable} (attribute: ttl).`);
  } catch (e) {
    // Already enabled from a previous run — ValidationException in that case, not fatal.
    console.log(`TTL on ${sessionsTable}: ${e instanceof Error ? e.message : e} (likely already enabled — safe to ignore).`);
  }

  console.log("\nDone. Set these in your .env (or server environment) to turn on owner login:");
  console.log(`  DYNAMODB_OWNERS_TABLE=${ownersTable}`);
  console.log(`  DYNAMODB_SESSIONS_TABLE=${sessionsTable}`);
  console.log(`  AWS_REGION=${region}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
