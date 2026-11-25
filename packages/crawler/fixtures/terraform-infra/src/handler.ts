import { PutCommand } from '@aws-sdk/lib-dynamodb';
/** Creates an order. */
export async function create() { return new PutCommand({ TableName: process.env.ORDERS_TABLE, Item: {} }); }
