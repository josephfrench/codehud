"""Order endpoints."""
from fastapi import APIRouter
from sqlalchemy import select
from app.models import Order
from app.services.billing import charge
from app.tasks import send_receipt

router = APIRouter(prefix="/orders")


@router.get("/")
def list_orders(session):
    return session.execute(select(Order)).scalars().all()


@router.post("/{order_id}/pay")
def pay(order_id: int, session):
    order = session.get(Order, order_id)
    charge(order)
    send_receipt.delay(order_id)
    return order
