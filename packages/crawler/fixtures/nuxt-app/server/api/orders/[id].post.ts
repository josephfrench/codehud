import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
/** Pays for an order. */
export default defineEventHandler(async () => stripe.paymentIntents.create({ amount: 1, currency: 'usd' }));
