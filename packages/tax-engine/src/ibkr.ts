import Decimal from "decimal.js";
import type { RawTransaction, Currency } from "./types.js";
import { splitCsvLine } from "./degiro.js";

// ---------------------------------------------------------------------------
// IBKR Activity Statement parser
// ---------------------------------------------------------------------------
// Parses the multi-section CSV exported by IBKR's "Activity Statement" report.
//
// Sections handled:
//   Trades              → BUY / SELL
//   Dividends           → DIVIDEND
//   Withholding Tax     → WITHHOLDING_TAX
//   Corporate Actions   → STOCK_SPLIT (for "Split N for M" descriptions only)
//
// All other sections (fees, transfers, positions, etc.) are silently ignored.
// The file may contain multiple account sections; all are processed in a single pass.

/**
 * Parses a complete IBKR Activity Statement CSV and returns RawTransaction[].
 */
export function parseIbkrActivity(csv: string): RawTransaction[] {
  const lines = csv.split("\n");

  // Pass 1 — build symbol→{isin, name} map from "Financial Instrument Information".
  // This section usually appears after Trades, so we need a separate pre-scan.
  const symbolInfo = new Map<string, { isin?: string; name?: string }>();
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("Financial Instrument Information,Data,")) continue;
    const cols = splitCsvLine(trimmed);
    if (cols[FI_ASSET_CATEGORY]?.trim() !== "Stocks") continue;
    const sym = cols[FI_SYMBOL]?.trim();
    if (!sym || symbolInfo.has(sym)) continue;
    const isin = cols[FI_ISIN]?.trim() || undefined;
    const name = cols[FI_NAME]?.trim() || undefined;
    symbolInfo.set(sym, {
      ...(isin !== undefined && { isin }),
      ...(name !== undefined && { name }),
    });
  }

  // Pass 2 — parse transactions.
  const results: RawTransaction[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    const cols = splitCsvLine(trimmed);
    const section = cols[0]?.trim();
    const rowType = cols[1]?.trim();

    if (rowType !== "Data") continue;

    let tx: RawTransaction | null = null;
    if (section === "Trades") {
      tx = parseTradeLine(cols, symbolInfo);
    } else if (section === "Dividends") {
      tx = parseDividendLine(cols);
    } else if (section === "Withholding Tax") {
      tx = parseWithholdingLine(cols);
    } else if (section === "Corporate Actions") {
      tx = parseCorporateActionLine(cols);
    }

    if (tx) results.push(tx);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Financial Instrument Information column indices
// Header: Asset Category,Symbol,Description,Conid,Security ID,...
// ---------------------------------------------------------------------------
const FI_ASSET_CATEGORY = 2;
const FI_SYMBOL = 3;
const FI_NAME = 4;
const FI_ISIN = 6; // "Security ID" column

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------
// Header: DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,
//         Quantity,T. Price,C. Price,Proceeds,Comm/Fee,...

const TR_DISCRIMINATOR = 2;
const TR_ASSET_CATEGORY = 3;
const TR_CURRENCY = 4;
const TR_SYMBOL = 5;
const TR_DATETIME = 6;
const TR_QUANTITY = 7;
const TR_PRICE = 8;
const TR_PROCEEDS = 10;
const TR_COMM = 11;

function parseTradeLine(
  cols: string[],
  symbolInfo: Map<string, { isin?: string; name?: string }>,
): RawTransaction | null {
  if (cols[TR_DISCRIMINATOR]?.trim() !== "Order") return null;
  if (cols[TR_ASSET_CATEGORY]?.trim() !== "Stocks") return null;

  const symbol = cols[TR_SYMBOL]?.trim();
  if (!symbol) return null;

  const date = parseIbkrDate(cols[TR_DATETIME]?.trim());
  if (!date) return null;

  const qtyRaw = parseAmount(cols[TR_QUANTITY]?.trim());
  if (!qtyRaw || qtyRaw.isZero()) return null;

  const type = qtyRaw.isPositive() ? "BUY" : "SELL";
  const quantity = qtyRaw.abs();
  const currency = (cols[TR_CURRENCY]?.trim() || "USD") as Currency;

  const price = parseAmount(cols[TR_PRICE]?.trim());
  const proceeds = parseAmount(cols[TR_PROCEEDS]?.trim());
  const commRaw = parseAmount(cols[TR_COMM]?.trim());

  // Proceeds: positive for SELL, negative for BUY → take abs as grossAmount.
  const grossAmount = proceeds?.abs() ?? quantity.mul(price ?? new Decimal(0));
  const commission = commRaw?.abs() ?? new Decimal(0);
  const netAmount =
    type === "BUY" ? grossAmount.add(commission) : grossAmount.sub(commission);

  const info = symbolInfo.get(symbol);

  return {
    id: crypto.randomUUID(),
    broker: "ibkr",
    date,
    type,
    symbol,
    ...(info?.isin !== undefined && { isin: info.isin }),
    ...(info?.name !== undefined && { name: info.name }),
    quantity,
    ...(price != null && { pricePerShare: price.abs() }),
    currency,
    grossAmount,
    commission,
    netAmount,
  };
}

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------
// Header: Currency,Date,Description,Amount

const DIV_CURRENCY = 2;
const DIV_DATE = 3;
const DIV_DESC = 4;
const DIV_AMOUNT = 5;

function parseDividendLine(cols: string[]): RawTransaction | null {
  const date = cols[DIV_DATE]?.trim();
  if (!date || !isIsoDate(date)) return null;

  const amountRaw = parseAmount(cols[DIV_AMOUNT]?.trim());
  // Skip Total rows (amount may be 0 or absent), and negative amounts (tax rows)
  if (!amountRaw || amountRaw.isZero() || amountRaw.isNegative()) return null;

  const currency = (cols[DIV_CURRENCY]?.trim() || "USD") as Currency;
  const description = cols[DIV_DESC]?.trim() ?? "";
  const parsed = parseSymbolFromDescription(description);
  const grossAmount = amountRaw;

  return {
    id: crypto.randomUUID(),
    broker: "ibkr",
    date,
    type: "DIVIDEND",
    symbol: parsed.symbol,
    ...(parsed.isin !== undefined && { isin: parsed.isin }),
    currency,
    grossAmount,
    commission: new Decimal(0),
    netAmount: grossAmount,
  };
}

// ---------------------------------------------------------------------------
// Withholding Tax
// ---------------------------------------------------------------------------
// Header: Currency,Date,Description,Amount,Code

const WHT_CURRENCY = 2;
const WHT_DATE = 3;
const WHT_DESC = 4;
const WHT_AMOUNT = 5;

function parseWithholdingLine(cols: string[]): RawTransaction | null {
  const date = cols[WHT_DATE]?.trim();
  if (!date || !isIsoDate(date)) return null;

  const amountRaw = parseAmount(cols[WHT_AMOUNT]?.trim());
  if (!amountRaw || amountRaw.isZero()) return null;

  // IBKR reports withholding tax as a negative amount; store as positive.
  const grossAmount = amountRaw.abs();
  const currency = (cols[WHT_CURRENCY]?.trim() || "USD") as Currency;
  const description = cols[WHT_DESC]?.trim() ?? "";
  const parsed = parseSymbolFromDescription(description);

  return {
    id: crypto.randomUUID(),
    broker: "ibkr",
    date,
    type: "WITHHOLDING_TAX",
    symbol: parsed.symbol,
    ...(parsed.isin !== undefined && { isin: parsed.isin }),
    currency,
    grossAmount,
    commission: new Decimal(0),
    netAmount: grossAmount,
  };
}

// ---------------------------------------------------------------------------
// Corporate Actions → STOCK_SPLIT
// ---------------------------------------------------------------------------
// Header: Asset Category,Currency,Report Date,Date/Time,Description,Quantity,...

const CA_ASSET_CATEGORY = 2;
const CA_CURRENCY = 3;
const CA_REPORT_DATE = 4;
const CA_DESC = 6;

function parseCorporateActionLine(cols: string[]): RawTransaction | null {
  if (cols[CA_ASSET_CATEGORY]?.trim() !== "Stocks") return null;

  // Use Report Date as the effective split date (the trading-day the split takes effect).
  const date = cols[CA_REPORT_DATE]?.trim();
  if (!date || !isIsoDate(date)) return null;

  const description = cols[CA_DESC]?.trim() ?? "";

  // Only process "Split N for M" corporate actions.
  const splitMatch = description.match(
    /Split\s+(\d+(?:\.\d+)?)\s+for\s+(\d+(?:\.\d+)?)/i,
  );
  if (!splitMatch) return null;

  const ratio = new Decimal(splitMatch[1]!).div(new Decimal(splitMatch[2]!));
  const parsed = parseSymbolFromDescription(description);
  const currency = (cols[CA_CURRENCY]?.trim() || "USD") as Currency;
  const ZERO = new Decimal(0);

  return {
    id: crypto.randomUUID(),
    broker: "ibkr",
    date,
    type: "STOCK_SPLIT",
    symbol: parsed.symbol,
    ...(parsed.isin !== undefined && { isin: parsed.isin }),
    quantity: ratio,
    currency,
    grossAmount: ZERO,
    commission: ZERO,
    netAmount: ZERO,
  };
}

// ---------------------------------------------------------------------------
// Parsing utilities
// ---------------------------------------------------------------------------

/**
 * Extracts symbol and ISIN from IBKR description strings.
 * Pattern: "SYMBOL(ISIN) rest..." e.g. "ABBV(US00287Y1091) Cash Dividend..."
 */
function parseSymbolFromDescription(desc: string): {
  symbol: string;
  isin?: string;
} {
  const m = desc.match(/^([A-Z0-9./]+)\(([A-Z0-9]+)\)/);
  if (m) return { symbol: m[1]!, isin: m[2]! };
  const symbolOnly = desc.match(/^([A-Z0-9./]+)/);
  return { symbol: symbolOnly?.[1] ?? "UNKNOWN" };
}

/**
 * Parses IBKR Date/Time field "YYYY-MM-DD, HH:MM:SS" → "YYYY-MM-DD".
 * Also accepts plain "YYYY-MM-DD".
 */
export function parseIbkrDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

/**
 * Parses a numeric string, stripping thousands commas before parsing.
 */
function parseAmount(s: string | undefined): Decimal | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, "");
  try {
    return new Decimal(cleaned);
  } catch {
    return null;
  }
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
