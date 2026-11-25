import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
const db = DynamoDBDocumentClient.from({} as any);
/** Marks queued orders as processed. */
export async function main() { await db.send(new UpdateCommand({ TableName: process.env.ORDERS_TABLE, Key: { pk: '1' } })); }
