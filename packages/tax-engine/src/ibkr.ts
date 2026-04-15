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
  // Accumulator for dividend accruals (must be aggregated before emitting).
  const accrualMap = new Map<string, AccrualGroup>();

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
    } else if (section === "Fees") {
      tx = parseFeeLine(cols);
    } else if (section === "CYEP/Broker Fees") {
      tx = parseCyepLine(cols);
    } else if (section === "Interest") {
      tx = parseInterestLine(cols);
    } else if (section === "Change in Dividend Accruals") {
      accumulateDividendAccrual(cols, accrualMap);
    }

    if (tx) results.push(tx);
  }

  // Finalise dividend accruals: emit one DIVIDEND (+optional WITHHOLDING_TAX)
  // per group where the net amount is non-zero.
  for (const group of accrualMap.values()) {
    const txs = finalizeDividendAccrualGroup(group);
    results.push(...txs);
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
// Corporate Actions → STOCK_SPLIT / SELL (merger, delisting)
// ---------------------------------------------------------------------------
// Header: Asset Category,Currency,Report Date,Date/Time,Description,Quantity,Proceeds,...

const CA_ASSET_CATEGORY = 2;
const CA_CURRENCY = 3;
const CA_REPORT_DATE = 4;
const CA_DESC = 6;
const CA_QUANTITY = 7;
const CA_PROCEEDS = 8;

function parseCorporateActionLine(cols: string[]): RawTransaction | null {
  if (cols[CA_ASSET_CATEGORY]?.trim() !== "Stocks") return null;

  // Use Report Date as the effective date (the trading-day the action takes effect).
  const date = cols[CA_REPORT_DATE]?.trim();
  if (!date || !isIsoDate(date)) return null;

  const description = cols[CA_DESC]?.trim() ?? "";
  const currency = (cols[CA_CURRENCY]?.trim() || "USD") as Currency;

  // ── Stock split ─────────────────────────────────────────────────────────────
  const splitMatch = description.match(
    /Split\s+(\d+(?:\.\d+)?)\s+for\s+(\d+(?:\.\d+)?)/i,
  );
  if (splitMatch) {
    const ratio = new Decimal(splitMatch[1]!).div(new Decimal(splitMatch[2]!));
    const parsed = parseSymbolFromDescription(description);
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

  // ── Merger / acquisition or delisting → close the position as a SELL ────────
  // Merger:   "SYMBOL(ISIN) Merged(Acquisition) for USD X per Share (...)"
  //            Proceeds > 0 (cash received at acquisition price)
  // Delisted: "(ISIN) Delisted (SYMBOL, Name, ISIN)"
  //            Proceeds = 0 (shares become worthless)
  const isMerger = /Merged|Acquisition/i.test(description);
  const isDelisted = /Delisted/i.test(description);
  if (!isMerger && !isDelisted) return null;

  const qtyRaw = parseAmount(cols[CA_QUANTITY]?.trim());
  if (!qtyRaw || qtyRaw.isZero()) return null;
  const quantity = qtyRaw.abs(); // IBKR reports removed shares as negative

  const proceeds = parseAmount(cols[CA_PROCEEDS]?.trim());
  const grossAmount = proceeds?.abs() ?? new Decimal(0);
  const pricePerShare = grossAmount.isZero()
    ? new Decimal(0)
    : grossAmount.div(quantity);

  const parsed = parseSymbolFromDescription(description);
  const ZERO = new Decimal(0);

  return {
    id: crypto.randomUUID(),
    broker: "ibkr",
    date,
    type: "SELL",
    symbol: parsed.symbol,
    ...(parsed.isin !== undefined && { isin: parsed.isin }),
    quantity,
    ...(pricePerShare.gt(0) && { pricePerShare }),
    currency,
    grossAmount,
    commission: ZERO,
    netAmount: grossAmount,
  };
}

// ---------------------------------------------------------------------------
// Fees  (IBKR "Fees" section — market-data subscriptions, misc account fees)
// ---------------------------------------------------------------------------
// Header: Subtitle,Currency,Date,Description,Amount
// Cols (after section+rowType):  2=Subtitle  3=Currency  4=Date  5=Desc  6=Amount

const FEE_SUBTITLE = 2;
const FEE_CURRENCY = 3;
const FEE_DATE = 4;
const FEE_DESC = 5;
const FEE_AMOUNT = 6;

function parseFeeLine(cols: string[]): RawTransaction | null {
  const subtitle = cols[FEE_SUBTITLE]?.trim() ?? "";
  // Skip aggregate/total rows
  if (!subtitle || subtitle.toLowerCase().startsWith("total")) return null;

  const date = cols[FEE_DATE]?.trim();
  if (!date || !isIsoDate(date)) return null;

  const amountRaw = parseAmount(cols[FEE_AMOUNT]?.trim());
  if (!amountRaw || amountRaw.isZero()) return null;

  const currency = (cols[FEE_CURRENCY]?.trim() || "USD") as Currency;
  const description = cols[FEE_DESC]?.trim() || undefined;
  const grossAmount = amountRaw.abs();
  // IBKR reports fees as negative; positive = credit/refund
  const type = amountRaw.isNegative() ? "FEE" : "OTHER_INCOME";

  return {
    id: crypto.randomUUID(),
    broker: "ibkr",
    date,
    type,
    symbol: "IBKR-FEES",
    tag: "ibkr-fee",
    ...(description !== undefined && { name: description }),
    currency,
    grossAmount,
    commission: new Decimal(0),
    netAmount: grossAmount,
  };
}

// ---------------------------------------------------------------------------
// CYEP / Broker Fees
// ---------------------------------------------------------------------------
// Header: Currency,Date,Description,Amount,Code
// Cols:  2=Currency  3=Date  4=Description  5=Amount  6=Code(optional)

const CYEP_CURRENCY = 2;
const CYEP_DATE = 3;
const CYEP_DESC = 4;
const CYEP_AMOUNT = 5;

function parseCyepLine(cols: string[]): RawTransaction | null {
  const date = cols[CYEP_DATE]?.trim();
  if (!date || !isIsoDate(date)) return null;

  const amountRaw = parseAmount(cols[CYEP_AMOUNT]?.trim());
  if (!amountRaw || amountRaw.isZero()) return null;

  const currency = (cols[CYEP_CURRENCY]?.trim() || "EUR") as Currency;
  const description = cols[CYEP_DESC]?.trim() || undefined;
  const grossAmount = amountRaw.abs();
  // Positive = income (CYEP credit), negative = cost (broker fee debit)
  const type = amountRaw.isPositive() ? "OTHER_INCOME" : "FEE";

  return {
    id: crypto.randomUUID(),
    broker: "ibkr",
    date,
    type,
    symbol: "CYEP",
    tag: "cyep",
    ...(description !== undefined && { name: description }),
    currency,
    grossAmount,
    commission: new Decimal(0),
    netAmount: grossAmount,
  };
}

// ---------------------------------------------------------------------------
// Interest
// ---------------------------------------------------------------------------
// Header: Currency,Date,Description,Amount
// Cols:  2=Currency  3=Date  4=Description  5=Amount

const INT_CURRENCY = 2;
const INT_DATE = 3;
const INT_DESC = 4;
const INT_AMOUNT = 5;

function parseInterestLine(cols: string[]): RawTransaction | null {
  const date = cols[INT_DATE]?.trim();
  if (!date || !isIsoDate(date)) return null;

  const amountRaw = parseAmount(cols[INT_AMOUNT]?.trim());
  if (!amountRaw || amountRaw.isZero()) return null;

  const currency = (cols[INT_CURRENCY]?.trim() || "EUR") as Currency;
  const description = cols[INT_DESC]?.trim() || undefined;
  const grossAmount = amountRaw.abs();
  // Positive = credit interest (income), negative = debit interest (cost)
  const type = amountRaw.isPositive() ? "OTHER_INCOME" : "FEE";

  return {
    id: crypto.randomUUID(),
    broker: "ibkr",
    date,
    type,
    symbol: "IBKR-INTEREST",
    tag: "interest",
    ...(description !== undefined && { name: description }),
    currency,
    grossAmount,
    commission: new Decimal(0),
    netAmount: grossAmount,
  };
}

// ---------------------------------------------------------------------------
// Change in Dividend Accruals
// ---------------------------------------------------------------------------
// Header: Asset Category,Currency,Symbol,Date,Ex Date,Pay Date,Quantity,Tax,Fee,
//         Gross Rate,Gross Amount,Net Amount,Code
// Cols:  2=AssetCat  3=Currency  4=Symbol  5=Date  6=ExDate  7=PayDate
//        8=Quantity  9=Tax  10=Fee  11=GrossRate  12=GrossAmount  13=NetAmount  14=Code

const DA_ASSET_CATEGORY = 2;
const DA_CURRENCY = 3;
const DA_SYMBOL = 4;
const DA_EX_DATE = 6;
const DA_PAY_DATE = 7;
const DA_TAX = 9;
const DA_GROSS_AMOUNT = 12;

interface AccrualGroup {
  symbol: string;
  currency: Currency;
  payDate: string;
  sumGross: Decimal;
  sumTax: Decimal;
}

function accumulateDividendAccrual(
  cols: string[],
  map: Map<string, AccrualGroup>,
): void {
  if (cols[DA_ASSET_CATEGORY]?.trim() !== "Stocks") return;

  const symbol = cols[DA_SYMBOL]?.trim();
  if (!symbol) return;

  const exDate = cols[DA_EX_DATE]?.trim();
  const payDate = cols[DA_PAY_DATE]?.trim();
  if (!exDate || !isIsoDate(exDate)) return;
  if (!payDate || !isIsoDate(payDate)) return;

  const grossAmount = parseAmount(cols[DA_GROSS_AMOUNT]?.trim());
  const taxAmount = parseAmount(cols[DA_TAX]?.trim());
  if (!grossAmount) return;

  const currency = (cols[DA_CURRENCY]?.trim() || "USD") as Currency;
  const key = `${symbol}|${exDate}|${payDate}`;

  const existing = map.get(key);
  if (existing) {
    existing.sumGross = existing.sumGross.add(grossAmount);
    existing.sumTax = existing.sumTax.add(taxAmount ?? new Decimal(0));
  } else {
    map.set(key, {
      symbol,
      currency,
      payDate,
      sumGross: grossAmount,
      sumTax: taxAmount ?? new Decimal(0),
    });
  }
}

function finalizeDividendAccrualGroup(group: AccrualGroup): RawTransaction[] {
  // Po+Re pairs that fully cancel → net 0 → no tax event (actual dividend is
  // already in the "Dividends" section). Only emit when net > 0.
  if (!group.sumGross.gt(0)) return [];

  const ZERO = new Decimal(0);
  const results: RawTransaction[] = [];

  results.push({
    id: crypto.randomUUID(),
    broker: "ibkr",
    date: group.payDate,
    type: "DIVIDEND",
    symbol: group.symbol,
    tag: "dividend-accrual",
    currency: group.currency,
    grossAmount: group.sumGross,
    commission: ZERO,
    netAmount: group.sumGross,
  });

  // Emit matched withholding tax if any was accrued
  if (group.sumTax.gt(0)) {
    results.push({
      id: crypto.randomUUID(),
      broker: "ibkr",
      date: group.payDate,
      type: "WITHHOLDING_TAX",
      symbol: group.symbol,
      tag: "dividend-accrual",
      currency: group.currency,
      grossAmount: group.sumTax,
      commission: ZERO,
      netAmount: group.sumTax,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Parsing utilities
// ---------------------------------------------------------------------------

/**
 * Extracts symbol and ISIN from IBKR description strings.
 *
 * Handles two formats:
 *   Standard: "SYMBOL(ISIN) rest..."
 *     e.g. "ABBV(US00287Y1091) Cash Dividend..."
 *          "NVDA(US67066G1040) Split 10 for 1..."
 *          "XM(US7476012015) Merged(Acquisition)..."
 *
 *   Delisted: "(ISIN) Delisted (SYMBOL, Name, ISIN)"
 *     e.g. "(US87663X1028) Delisted (TTCF, TATTOOED CHEF INC, US87663X1028)"
 *     → ISIN from the first group, symbol from the second group's first field.
 */
function parseSymbolFromDescription(desc: string): {
  symbol: string;
  isin?: string;
} {
  // Standard: SYMBOL(ISIN) ...
  const standard = desc.match(/^([A-Z0-9./]+)\(([A-Z0-9]+)\)/);
  if (standard) return { symbol: standard[1]!, isin: standard[2]! };

  // Delisted: (ISIN) ... (SYMBOL, Name, ...)
  const delisted = desc.match(/^\(([A-Z0-9]+)\)[^(]*\(([A-Z0-9.]+),/);
  if (delisted) return { symbol: delisted[2]!, isin: delisted[1]! };

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
