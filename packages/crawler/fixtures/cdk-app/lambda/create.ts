import { PutCommand } from '@aws-sdk/lib-dynamodb';
/** Writes an order. */
export const handler = async () => new PutCommand({ TableName: process.env.TABLE_NAME, Item: {} });
