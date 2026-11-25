import { listOrders } from '~/server/utils/orders';
/** Lists orders for the current user. */
export default defineEventHandler(() => listOrders());
