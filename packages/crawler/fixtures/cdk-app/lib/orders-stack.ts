import { Stack, StackProps } from 'aws-cdk-lib';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export class OrdersStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const orders = new Table(this, 'OrdersTable', { partitionKey: { name: 'pk', type: AttributeType.STRING }, sortKey: { name: 'sk', type: AttributeType.STRING } });
    const queue = new Queue(this, 'OrdersQueue');
    const uploads = new Bucket(this, 'Uploads');
    const api = new HttpApi(this, 'OrdersApi');
    const createFn = new NodejsFunction(this, 'CreateOrder', { entry: 'lambda/create.ts', environment: { TABLE_NAME: orders.tableName, QUEUE_URL: queue.queueUrl } });
    const processFn = new NodejsFunction(this, 'ProcessOrder', { entry: 'lambda/process.ts', environment: { TABLE_NAME: orders.tableName } });
    orders.grantReadWriteData(createFn);
    orders.grantWriteData(processFn);
    queue.grantSendMessages(createFn);
    uploads.grantRead(processFn);
    processFn.addEventSource(new SqsEventSource(queue));
    api.addRoutes({ path: '/orders', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('create', createFn) });
  }
}
