import type Decimal from "decimal.js";

/** Format a Decimal as a PLN amount with 2 decimal places and thousands separator. */
export function formatPLN(value: Decimal): string {
  const n = value.toNumber();
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Format a Decimal as a number with 4 decimal places (for quantities). */
export function formatQty(value: Decimal): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}
