import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { OrdersService } from './orders.service';
/** HTTP surface for orders. */
@Controller('orders')
@UseGuards(JwtGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get()
  list() { return this.orders.findAll(); }
  @Get(':id')
  one(@Param('id') id: string) { return this.orders.findOne(id); }
  @Post()
  create(@Body() body: unknown) { return this.orders.create(body); }
}
