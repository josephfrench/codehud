"""Stripe charges."""
import os
import stripe

stripe.api_key = os.environ["STRIPE_SECRET_KEY"]


def charge(order):
    return stripe.PaymentIntent.create(amount=order.total_cents, currency="usd")
