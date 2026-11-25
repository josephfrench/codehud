"""Shop models."""
from django.db import models


class Product(models.Model):
    name = models.CharField(max_length=200)
    price_cents = models.IntegerField()


class Order(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    email = models.EmailField()

    class Meta:
        db_table = "shop_orders"
