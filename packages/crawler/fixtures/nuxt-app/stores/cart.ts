import { defineStore } from 'pinia';
/** Cart contents, persisted per session. */
export const useCartStore = defineStore('cart', { state: () => ({ items: [] as string[] }) });
