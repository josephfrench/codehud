import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Order } from './order.entity';
/** Order persistence and lifecycle events. */
@Injectable()
export class OrdersService {
  constructor(@InjectRepository(Order) private repo: Repository<Order>, private events: EventEmitter2, @InjectQueue('billing') private billing: Queue) {}
  findAll() { return this.repo.find(); }
  findOne(id: string) { return this.repo.findOneBy({ id }); }
  async create(body: unknown) { const o = await this.repo.save(body as Order); this.events.emit('order.created', o); await this.billing.add('charge', o); return o; }
}
