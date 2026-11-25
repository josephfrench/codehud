<script setup lang="ts">
import { useCartStore } from '~/stores/cart';
const cart = useCartStore();
const { data } = await useFetch(`/api/orders/${useRoute().params.id}`);
</script>
<template><div>{{ data }}</div></template>
