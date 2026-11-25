import express from 'express';
import { User } from './models/user';
import { Order } from './models/order';
const app = express();
/** Lists users. */
app.get('/users', async (_req, res) => res.json(await User.find()));
app.post('/users', async (req, res) => res.json(await User.create(req.body)));
app.get('/orders/:id', async (req, res) => res.json(await Order.findById(req.params.id)));
app.listen(3000);
