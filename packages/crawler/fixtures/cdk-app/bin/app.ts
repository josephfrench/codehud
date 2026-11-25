import { App } from 'aws-cdk-lib';
import { OrdersStack } from '../lib/orders-stack';
new OrdersStack(new App(), 'Orders');
