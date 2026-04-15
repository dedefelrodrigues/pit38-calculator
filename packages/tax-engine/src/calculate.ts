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
 * `carryForwardDeducted` — amount of prior-year losses to subtract from the
 * gain before computing taxBase. Pass ZERO (default) for the simple case.
 *
 * Polish PIT-38 (Art. 9 ust. 3): losses may be carried forward for 5 years,
 * with a cap of 50% of the original loss per deduction year.
 */
export function computeEquitySummary(
  matches: FifoMatch[],
  year: number,
  carryForwardDeducted: Decimal = ZERO,
): EquitySummary {
  const yearMatches = matches.filter((m) =>
    m.sellDate.startsWith(`${year}`),
  );
  const totalRevenuePLN = sum(yearMatches.map((m) => m.revenueGrossPLN));
  const totalCostPLN = sum(
    yearMatches.map((m) => m.costBasisPLN.add(m.commissionSellPLN)),
  );
  const totalGainLossPLN = totalRevenuePLN.sub(totalCostPLN);
  const taxBase = Decimal.max(ZERO, totalGainLossPLN.sub(carryForwardDeducted));
  return {
    year,
    totalRevenuePLN,
    totalCostPLN,
    totalGainLossPLN,
    lossCarryForwardDeducted: carryForwardDeducted,
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
 *
 * `options` controls which tagged categories are included:
 *  - `includeOtherIncome`  — master switch for untagged FEE/OTHER_INCOME
 *  - `includeCyep`         — CYEP/Broker Fees (overrides the master switch)
 *  - `includeInterest`     — IBKR interest (overrides the master switch)
 *
 * When called without options all transactions are included (backward-compat).
 */
export function computeOtherIncomeSummary(
  transactions: Transaction[],
  year: number,
  options: {
    includeOtherIncome?: boolean;
    includeCyep?: boolean;
    includeInterest?: boolean;
  } = {},
): OtherIncomeSummary {
  const {
    includeOtherIncome = true,
    includeCyep = true,
    includeInterest = true,
  } = options;

  const yearTxs = transactions.filter((tx) => {
    if (!(tx.type === "OTHER_INCOME" || tx.type === "FEE")) return false;
    if (!tx.date.startsWith(`${year}`)) return false;
    // Tag-specific overrides (independent of the master switch)
    if (tx.tag === "cyep") return includeCyep;
    if (tx.tag === "interest") return includeInterest;
    // Untagged transactions respect the master switch
    return includeOtherIncome;
  });

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
   * When true, untagged OTHER_INCOME and FEE transactions contribute to
   * OtherIncomeSummary. CYEP and Interest have their own independent flags.
   *
   * Default: false (common PIT-38 case: equity + dividends only).
   */
  includeOtherIncome?: boolean;

  /**
   * When true, equity losses are carried forward under Art. 9 ust. 3 ustawy
   * o PIT (5-year window, 50% cap per deduction year, oldest-first).
   *
   * Default: false.
   */
  lossCarryForward?: boolean;

  /**
   * Additional prior-year losses to seed into the carry-forward pool before
   * processing the uploaded transactions. Useful when the user has historical
   * losses from years before their uploaded data range.
   *
   * Each entry specifies the absolute (positive) loss amount for a given year.
   * These entries are subject to the same 5-year window and 50% cap rules.
   * They are applied regardless of the `lossCarryForward` flag.
   */
  priorYearLosses?: Array<{ year: number; lossAmountPLN: Decimal }>;

  /**
   * When true, IBKR CYEP/Broker Fees transactions are included in the tax
   * calculation regardless of the `includeOtherIncome` setting.
   * Positive CYEP = taxable income; negative CYEP = deductible cost.
   *
   * Default: true.
   */
  includeCyep?: boolean;

  /**
   * When true, IBKR Interest transactions are included in the tax calculation
   * regardless of the `includeOtherIncome` setting.
   *
   * Default: true.
   */
  includeInterest?: boolean;

  /**
   * When true, net non-zero dividend accruals (from IBKR "Change in Dividend
   * Accruals" section) are included as DIVIDEND income. Fully reconciled
   * Po+Re pairs (net = 0) never produce a tax event regardless of this flag.
   *
   * Default: true.
   */
  includeDividendAccruals?: boolean;
}


// Internal structure for tracking a single prior-year loss available for carry.
interface CarryEntry {
  fromYear: number;
  /** Absolute value of the original loss. */
  originalLoss: Decimal;
  /** Amount not yet deducted in any gain year. */
  remaining: Decimal;
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
  const {
    includeOtherIncome = false,
    lossCarryForward = false,
    includeCyep = true,
    includeInterest = true,
    includeDividendAccruals = true,
    priorYearLosses = [],
  } = options;

  // Carry-forward is active if either the auto flag is on or prior losses were supplied.
  const effectiveLCF = lossCarryForward || priorYearLosses.length > 0;

  // Pre-filter: remove transactions whose tag-based category is disabled.
  const filtered = transactions.filter((tx) => {
    if (tx.tag === "dividend-accrual" && !includeDividendAccruals) return false;
    if (tx.tag === "cyep" && !includeCyep) return false;
    if (tx.tag === "interest" && !includeInterest) return false;
    return true;
  });

  // Run FIFO across ALL years (lots can carry over year boundaries).
  const { matches } = processFifo(filtered);
  const dividendItems = matchDividendsWithholding(filtered);

  // Collect all years with reportable activity.
  const years = new Set<number>();
  for (const m of matches) years.add(Number(m.sellDate.slice(0, 4)));
  for (const d of dividendItems) years.add(Number(d.date.slice(0, 4)));
  // Always collect years for CYEP / interest (their own flags control inclusion);
  // only collect years for untagged other-income when the master flag is on.
  for (const tx of filtered) {
    if (tx.type !== "OTHER_INCOME" && tx.type !== "FEE") continue;
    if (tx.tag === "cyep" || tx.tag === "interest") {
      years.add(Number(tx.date.slice(0, 4)));
    } else if (includeOtherIncome) {
      years.add(Number(tx.date.slice(0, 4)));
    }
  }

  // Process years in chronological order so carry-forward state accumulates
  // correctly. The result map preserves insertion order (= chronological).
  const yearsSorted = [...years].sort((a, b) => a - b);

  // Seed carry pool with user-supplied prior-year losses (oldest first).
  const carryEntries: CarryEntry[] = [...priorYearLosses]
    .sort((a, b) => a.year - b.year)
    .map((p) => ({
      fromYear: p.year,
      originalLoss: p.lossAmountPLN,
      remaining: p.lossAmountPLN,
    }));

  const result = new Map<number, TaxSummary>();

  for (const year of yearsSorted) {
    // --- Equity: optionally apply carry-forward deductions ---
    let carryDeducted = ZERO;

    if (effectiveLCF) {
      // Peek at the raw gain/loss before applying carry-forward.
      const rawGainLoss = computeEquitySummary(matches, year).totalGainLossPLN;

      if (rawGainLoss.gt(0)) {
        // Apply oldest carry entries first (maximises use of losses nearing expiry).
        let remainingGain = rawGainLoss;
        for (const entry of carryEntries) {
          if (remainingGain.lte(0)) break;
          if (entry.fromYear >= year) continue;      // can only carry forward (past → future)
          if (year - entry.fromYear > 5) continue; // expired (> 5-year window)
          if (entry.remaining.lte(0)) continue;    // fully used

          // Per-year deduction cap: 50% of that year's original loss.
          const cap = entry.originalLoss.mul("0.5");
          const canDeduct = Decimal.min(cap, entry.remaining, remainingGain);
          entry.remaining = entry.remaining.sub(canDeduct);
          carryDeducted = carryDeducted.add(canDeduct);
          remainingGain = remainingGain.sub(canDeduct);
        }
      }
    }

    const equity = computeEquitySummary(matches, year, carryDeducted);

    // Record a new loss entry for future carry-forward use.
    // Auto-detected data losses are only added when lossCarryForward is true.
    if (lossCarryForward && equity.totalGainLossPLN.lt(0)) {
      carryEntries.push({
        fromYear: year,
        originalLoss: equity.totalGainLossPLN.abs(),
        remaining: equity.totalGainLossPLN.abs(),
      });
    }

    const dividends = computeDividendSummary(dividendItems, year);
    const otherIncome = computeOtherIncomeSummary(filtered, year, {
      includeOtherIncome,
      includeCyep,
      includeInterest,
    });

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
