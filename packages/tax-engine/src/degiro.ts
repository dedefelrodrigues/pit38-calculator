import Decimal from "decimal.js";
import type { RawTransaction, Currency } from "./types.js";

// ---------------------------------------------------------------------------
// DEGIRO Trades CSV parser
// ---------------------------------------------------------------------------
// Column indices for the "Account > Transactions" export.
// Header: Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,
// Note: the UUID appears at col 17 (after the trailing comma in the header),
// while col 16 ("Order ID") is always empty in practice.
const T_DATE = 0;
const T_PRODUCT = 2;
const T_ISIN = 3;
const T_QUANTITY = 6;
const T_PRICE = 7;
// col 8 = price currency (empty header)
const T_LOCAL_VALUE = 9;
const T_LOCAL_CURRENCY = 10; // empty header = local value currency
const T_VALUE_EUR = 11;
const T_FX_RATE = 12;
const T_FEES_EUR = 14;
const T_ORDER_UUID = 17;

/**
 * Parses a DEGIRO transactions CSV ("Account > Transactions" export).
 *
 * - BUY rows: Quantity > 0
 * - SELL rows: Quantity < 0
 * - Non-EUR trades: amounts are normalised to EUR using the DEGIRO FX rate
 *   in col 12 so that commission (always quoted in EUR) stays consistent.
 * - Header row is auto-detected and skipped.
 *
 * Returns one RawTransaction per data row.
 */
export function parseDegiroTrades(csv: string): RawTransaction[] {
  const results: RawTransaction[] = [];

  for (const line of csv.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    const cols = splitCsvLine(trimmed);

    // Skip header
    if (cols[T_DATE]?.trim().toLowerCase() === "date") continue;

    const date = parseDegiroDate(cols[T_DATE]?.trim());
    if (!date) continue;

    const quantityRaw = parseDecimal(cols[T_QUANTITY]?.trim());
    if (!quantityRaw || quantityRaw.isZero()) continue;

    const type = quantityRaw.greaterThan(0) ? "BUY" : "SELL";
    const quantity = quantityRaw.abs();

    const localCurrency = (cols[T_LOCAL_CURRENCY]?.trim() || "EUR") as Currency;
    const localValue = parseDecimal(cols[T_LOCAL_VALUE]?.trim());
    const price = parseDecimal(cols[T_PRICE]?.trim());
    const feesEur = parseDecimal(cols[T_FEES_EUR]?.trim())?.abs() ?? new Decimal(0);
    const fxRate = parseDecimal(cols[T_FX_RATE]?.trim());

    let currency: Currency;
    let grossAmount: Decimal;
    let commission: Decimal;

    if (!fxRate || fxRate.isZero() || localCurrency === "EUR") {
      // Trade already in EUR — use local values directly.
      currency = localCurrency;
      grossAmount = localValue?.abs() ?? quantity.mul(price ?? new Decimal(0));
      commission = feesEur;
    } else {
      // Non-EUR trade: DEGIRO auto-converted to EUR.
      // Using EUR values keeps commission (always EUR) in the same currency.
      const valueEur = parseDecimal(cols[T_VALUE_EUR]?.trim());
      currency = "EUR";
      grossAmount = valueEur?.abs() ?? new Decimal(0);
      commission = feesEur;
    }

    const netAmount =
      type === "BUY" ? grossAmount.add(commission) : grossAmount.sub(commission);

    const isin = cols[T_ISIN]?.trim() || undefined;
    const name = cols[T_PRODUCT]?.trim() || undefined;
    // DEGIRO does not export ticker symbols; use ISIN as the stable identifier.
    const symbol = isin ?? name ?? "UNKNOWN";

    const uuidCol = cols[T_ORDER_UUID]?.trim();
    const id = uuidCol || crypto.randomUUID();

    results.push({
      id,
      broker: "degiro",
      date,
      type,
      symbol,
      ...(isin !== undefined && { isin }),
      ...(name !== undefined && { name }),
      quantity,
      ...(price != null && { pricePerShare: price.abs() }),
      currency,
      grossAmount,
      commission,
      netAmount,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// DEGIRO Account CSV parser (dividends, withholding tax, fees, interest)
// ---------------------------------------------------------------------------
// Column indices for the "Account > Account statement" export.
// Header: Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
const A_DATE = 0;
const A_PRODUCT = 3;
const A_ISIN = 4;
const A_DESCRIPTION = 5;
// col 6 = FX rate used for this entry (if any)
const A_CHANGE_CURRENCY = 7;
const A_CHANGE_AMOUNT = 8;
const A_ORDER_ID = 11;

/**
 * Parses a DEGIRO account statement CSV ("Account > Account statement" export).
 *
 * Extracted row types:
 * - DIVIDEND        — rows whose description contains "dividend" (not withholding)
 * - WITHHOLDING_TAX — rows whose description contains "withholding" or "dividend tax"
 * - FEE             — DEGIRO service/custody/connection fees
 * - OTHER_INCOME    — interest income
 *
 * Skipped: cash sweeps, inter-account transfers, zero-amount rows, unknown rows.
 *
 * Returns one RawTransaction per matched data row.
 */
export function parseDegiroAccount(csv: string): RawTransaction[] {
  const results: RawTransaction[] = [];

  for (const line of csv.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    const cols = splitCsvLine(trimmed);

    // Skip header
    if (cols[A_DATE]?.trim().toLowerCase() === "date") continue;

    const date = parseDegiroDate(cols[A_DATE]?.trim());
    if (!date) continue;

    const changeAmount = parseDecimal(cols[A_CHANGE_AMOUNT]?.trim());
    if (!changeAmount || changeAmount.isZero()) continue;

    const description = cols[A_DESCRIPTION]?.trim() ?? "";
    const descLower = description.toLowerCase();

    if (isSkippable(descLower)) continue;

    const type = classifyDescription(descLower);
    if (!type) continue; // unknown row type

    const currency = (cols[A_CHANGE_CURRENCY]?.trim() || "EUR") as Currency;
    const grossAmount = changeAmount.abs();
    const commission = new Decimal(0);
    const netAmount = grossAmount;

    const isin = cols[A_ISIN]?.trim() || undefined;
    const name = cols[A_PRODUCT]?.trim() || undefined;
    const symbol = isin ?? name ?? "UNKNOWN";

    const orderId = cols[A_ORDER_ID]?.trim();
    const id = orderId || crypto.randomUUID();

    results.push({
      id,
      broker: "degiro",
      date,
      type,
      symbol,
      ...(isin !== undefined && { isin }),
      ...(name !== undefined && { name }),
      currency,
      grossAmount,
      commission,
      netAmount,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function isSkippable(desc: string): boolean {
  return (
    desc.includes("cash sweep") ||
    desc.includes("transfer from") ||
    desc.includes("transfer to") ||
    desc.startsWith("flatex deposit") ||
    desc.startsWith("flatex withdrawal")
  );
}

function classifyDescription(
  desc: string
): RawTransaction["type"] | null {
  if (isWithholdingTax(desc)) return "WITHHOLDING_TAX";
  if (isDividend(desc)) return "DIVIDEND";
  if (isFee(desc)) return "FEE";
  if (isInterest(desc)) return "OTHER_INCOME";
  return null;
}

function isDividend(desc: string): boolean {
  return desc.includes("dividend") && !isWithholdingTax(desc);
}

function isWithholdingTax(desc: string): boolean {
  return (
    desc.includes("withholding") ||
    (desc.includes("dividend") && desc.includes("tax"))
  );
}

function isFee(desc: string): boolean {
  return desc.includes("fee");
}

function isInterest(desc: string): boolean {
  return desc.includes("interest");
}

// ---------------------------------------------------------------------------
// Parsing utilities
// ---------------------------------------------------------------------------

/**
 * Converts a DEGIRO date string "DD-MM-YYYY" to ISO "YYYY-MM-DD".
 * Returns null for any other format.
 */
export function parseDegiroDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Parses a decimal number. Returns null if the string is empty or non-numeric.
 * DEGIRO CSV exports use period as the decimal separator.
 */
function parseDecimal(s: string | undefined): Decimal | null {
  if (!s) return null;
  try {
    return new Decimal(s);
  } catch {
    return null;
  }
}

/**
 * Splits a single CSV line by commas, respecting double-quoted fields.
 */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);

  return result;
}
