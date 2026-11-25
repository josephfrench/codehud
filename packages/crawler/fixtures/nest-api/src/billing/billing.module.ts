import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BillingProcessor } from './billing.processor';
import { BillingListener } from './billing.listener';
@Module({ imports: [BullModule.registerQueue({ name: 'billing' })], providers: [BillingProcessor, BillingListener] })
export class BillingModule {}
