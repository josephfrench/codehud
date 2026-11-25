import { Schema, model } from 'mongoose';
const orderSchema = new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User' }, total: Number });
export const Order = model('Order', orderSchema);
