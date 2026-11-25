import { Hono } from 'hono';
import { money } from '../../shared/src/index';
import { legacy } from './legacy';
const app = new Hono();
/** Orders over HTTP. */
app.get('/api/orders', (c) => c.json([money(1), legacy()]));
app.post('/api/orders', (c) => c.json({}));
export default app;
