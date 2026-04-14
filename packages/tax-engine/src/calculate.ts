import Decimal from "decimal.js";
import type {
  Transaction,
  FifoMatch,
  DividendItem,
  EquitySummary,
  DividendSummary,
  OtherIncomeSummary,
  TaxSummary,
} from "./types.js";
import { processFifo } from "./fifo.js";

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

function sum(ds: Decimal[]): Decimal {
  return ds.reduce((a, b) => a.add(b), ZERO);
}

// ---------------------------------------------------------------------------
// Step 1 — Match dividends with withholding tax entries
// ---------------------------------------------------------------------------

/**
 * Groups DIVIDEND transactions and matches them to WITHHOLDING_TAX entries
 * by (symbol, date). Multiple WHT rows on the same key are summed.
 */
export function matchDividendsWithholding(
  transactions: Transaction[],
): DividendItem[] {
  // Build WHT lookup: key = `${symbol}|${date}` → total withholdingPLN (sum)
  const whtMap = new Map<string, Decimal>();
  for (const tx of transactions) {
    if (tx.type !== "WITHHOLDING_TAX") continue;
    const key = `${tx.symbol}|${tx.date}`;
    whtMap.set(key, (whtMap.get(key) ?? ZERO).add(tx.grossAmountPLN));
  }

  return transactions
    .filter((tx) => tx.type === "DIVIDEND" && tx.grossAmountPLN.gt(0))
    .map((tx) => ({
      txId: tx.id,
      symbol: tx.symbol,
      date: tx.date,
      currency: tx.currency,
      grossAmountPLN: tx.grossAmountPLN,
      withholdingTaxPLN:
        whtMap.get(`${tx.symbol}|${tx.date}`) ?? ZERO,
    }));
}

// ---------------------------------------------------------------------------
// Step 2 — Per-year equity summary
// ---------------------------------------------------------------------------

/**
 * Filters FifoMatches by sellDate year and computes the equity tax summary.
 *
 * Polish PIT-38 does NOT allow carrying losses forward across years.
 * Each year is computed independently: taxBase = max(0, gain).
 */
export function computeEquitySummary(
  matches: FifoMatch[],
  year: number,
): EquitySummary {
  const yearMatches = matches.filter((m) =>
    m.sellDate.startsWith(`${year}`),
  );
  const totalRevenuePLN = sum(yearMatches.map((m) => m.revenueGrossPLN));
  const totalCostPLN = sum(
    yearMatches.map((m) => m.costBasisPLN.add(m.commissionSellPLN)),
  );
  const totalGainLossPLN = totalRevenuePLN.sub(totalCostPLN);
  const taxBase = Decimal.max(ZERO, totalGainLossPLN);
  return {
    year,
    totalRevenuePLN,
    totalCostPLN,
    totalGainLossPLN,
    taxBase,
    taxDue: taxBase.mul("0.19"),
    matches: yearMatches,
  };
}

// ---------------------------------------------------------------------------
// Step 3 — Per-year dividend summary
// ---------------------------------------------------------------------------

/**
 * Filters DividendItems by year and computes the dividend tax summary.
 *
 * Polish tax on dividends is 19% of the gross amount. Foreign WHT is
 * credited up to the full Polish tax amount (cannot create a refund).
 */
export function computeDividendSummary(
  items: DividendItem[],
  year: number,
): DividendSummary {
  const yearItems = items.filter((i) => i.date.startsWith(`${year}`));
  const grossDividendsPLN = sum(yearItems.map((i) => i.grossAmountPLN));
  const totalWithholdingTaxPLN = sum(
    yearItems.map((i) => i.withholdingTaxPLN),
  );
  const polishTaxGross = grossDividendsPLN.mul("0.19");
  const taxCredit = Decimal.min(polishTaxGross, totalWithholdingTaxPLN);
  const taxDue = Decimal.max(ZERO, polishTaxGross.sub(taxCredit));
  return {
    year,
    grossDividendsPLN,
    totalWithholdingTaxPLN,
    polishTaxGross,
    taxCredit,
    taxDue,
    items: yearItems,
  };
}

// ---------------------------------------------------------------------------
// Step 4 — Per-year other income summary
// ---------------------------------------------------------------------------

/**
 * Filters OTHER_INCOME and FEE transactions by year.
 * OTHER_INCOME contributes as income; FEE contributes as cost.
 */
export function computeOtherIncomeSummary(
  transactions: Transaction[],
  year: number,
): OtherIncomeSummary {
  const yearTxs = transactions.filter(
    (tx) =>
      (tx.type === "OTHER_INCOME" || tx.type === "FEE") &&
      tx.date.startsWith(`${year}`),
  );
  const totalIncomePLN = sum(
    yearTxs
      .filter((t) => t.type === "OTHER_INCOME")
      .map((t) => t.grossAmountPLN),
  );
  const totalCostPLN = sum(
    yearTxs.filter((t) => t.type === "FEE").map((t) => t.grossAmountPLN),
  );
  const gainLossPLN = totalIncomePLN.sub(totalCostPLN);
  return {
    year,
    totalIncomePLN,
    totalCostPLN,
    gainLossPLN,
    taxDue: Decimal.max(ZERO, gainLossPLN.mul("0.19")),
  };
}

// ---------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------

export interface CalculateTaxOptions {
  /**
   * When true, OTHER_INCOME and FEE transactions contribute to
   * OtherIncomeSummary and their taxDue is included in totalTaxDue.
   *
   * Default: false — other income is excluded from the tax calculation.
   * This is the common case for PIT-38 where users report only equity
   * and dividends; interest / FX gains may be reported separately.
   */
  includeOtherIncome?: boolean;
}

const ZERO_DECIMAL = new Decimal(0);

function zeroOtherIncome(year: number): OtherIncomeSummary {
  return {
    year,
    totalIncomePLN: ZERO_DECIMAL,
    totalCostPLN: ZERO_DECIMAL,
    gainLossPLN: ZERO_DECIMAL,
    taxDue: ZERO_DECIMAL,
  };
}

/**
 * Main entry point. Processes a mixed list of enriched transactions and
 * returns a map from year → TaxSummary.
 *
 * The map contains only years with taxable activity (equity sells,
 * dividend receipts, or — when includeOtherIncome=true — other income/fees).
 */
export function calculateTax(
  transactions: Transaction[],
  options: CalculateTaxOptions = {},
): Map<number, TaxSummary> {
  const { includeOtherIncome = false } = options;

  // Run FIFO across ALL years (lots can carry over year boundaries).
  const { matches } = processFifo(transactions);
  const dividendItems = matchDividendsWithholding(transactions);

  // Collect all years with reportable activity.
  const years = new Set<number>();
  for (const m of matches) years.add(Number(m.sellDate.slice(0, 4)));
  for (const d of dividendItems) years.add(Number(d.date.slice(0, 4)));
  if (includeOtherIncome) {
    for (const tx of transactions) {
      if (tx.type === "OTHER_INCOME" || tx.type === "FEE")
        years.add(Number(tx.date.slice(0, 4)));
    }
  }

  const result = new Map<number, TaxSummary>();
  for (const year of years) {
    const equity = computeEquitySummary(matches, year);
    const dividends = computeDividendSummary(dividendItems, year);
    const otherIncome = includeOtherIncome
      ? computeOtherIncomeSummary(transactions, year)
      : zeroOtherIncome(year);
    result.set(year, {
      year,
      equity,
      dividends,
      otherIncome,
      totalTaxDue: equity.taxDue
        .add(dividends.taxDue)
        .add(otherIncome.taxDue),
    });
  }
  return result;
}
