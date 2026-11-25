from django.urls import path
from shop import views

urlpatterns = [
    path('products/', views.product_list, name='products'),
    path('orders/<int:pk>/', views.order_create, name='order'),
]
