import Fastify from 'fastify';
import { Customer } from './db';
const app = Fastify();
app.get('/customers', async () => Customer.findAll());
app.post('/customers', async (req) => Customer.create(req.body as any));
