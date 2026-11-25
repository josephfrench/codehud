"""Background jobs."""
from celery import shared_task


@shared_task
def send_receipt(order_id: int):
    return order_id
