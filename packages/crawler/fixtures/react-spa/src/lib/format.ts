/** Money formatting. */
export function money(n: number): string { return `$${n.toFixed(2)}`; }
export const CURRENCY = 'USD';
