"""Shop views."""
from django.http import JsonResponse
from shop.models import Order, Product


def product_list(request):
    return JsonResponse(list(Product.objects.all().values()), safe=False)


def order_create(request):
    Order.objects.create(email=request.POST["email"], product_id=1)
    return JsonResponse({})
