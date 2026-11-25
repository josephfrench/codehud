import { Component, inject } from '@angular/core';
import { OrdersService } from './orders.service';
/** Lists the customer's orders. */
@Component({ selector: 'app-orders', template: '<ul></ul>' })
export class OrdersComponent { private svc = inject(OrdersService); }
