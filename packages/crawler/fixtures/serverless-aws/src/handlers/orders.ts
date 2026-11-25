import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { newId } from '../lib/ids';
const db = DynamoDBDocumentClient.from({} as any);
/** Creates an order and queues it for processing. */
export async function create() {
  await db.send(new PutCommand({ TableName: process.env.ORDERS_TABLE, Item: { pk: newId() } }));
  await new SQSClient({}).send(new SendMessageCommand({ QueueUrl: process.env.ORDERS_QUEUE_URL, MessageBody: '{}' }));
}
export async function get() {
  return db.send(new GetCommand({ TableName: process.env.ORDERS_TABLE, Key: { pk: '1' } }));
}
