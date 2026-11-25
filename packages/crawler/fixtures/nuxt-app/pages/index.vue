<script setup lang="ts">
/** Landing page listing featured orders. */
import OrderCard from '~/components/OrderCard.vue';
const { orders } = useOrders();
</script>
<template><OrderCard v-for="o in orders" :key="o.id" /><NuxtLink to="/orders/1">one</NuxtLink></template>
