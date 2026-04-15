import type Decimal from "decimal.js";

export function formatPLN(value: Decimal): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value.toNumber());
}

export function formatNumber(value: Decimal, decimals = 2): string {
  return new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value.toNumber());
}

export function formatQty(value: Decimal): string {
  const n = value.toNumber();
  if (Number.isInteger(n)) return String(n);
  return new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n);
}
