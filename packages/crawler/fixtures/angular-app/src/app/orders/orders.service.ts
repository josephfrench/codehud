import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
/** Talks to the orders API. */
@Injectable({ providedIn: 'root' })
export class OrdersService {
  private http = inject(HttpClient);
  list() { return this.http.get<unknown[]>('/api/orders'); }
  create(body: unknown) { return this.http.post('/api/orders', body); }
}
