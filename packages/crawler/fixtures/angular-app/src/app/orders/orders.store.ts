import { createFeature, createReducer } from '@ngrx/store';
export const ordersFeature = createFeature({ name: 'orders', reducer: createReducer({ items: [] }) });
