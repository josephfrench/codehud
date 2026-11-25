import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from './orders/orders.module';
import { BillingModule } from './billing/billing.module';
@Module({ imports: [TypeOrmModule.forRoot({ type: 'postgres' }), OrdersModule, BillingModule] })
export class AppModule {}
