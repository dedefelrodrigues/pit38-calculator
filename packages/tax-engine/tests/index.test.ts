import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import type { Transaction } from "../src/types.js";
import {
  calculateTax,
  matchDividendsWithholding,
  computeEquitySummary,
  computeDividendSummary,
} from "../src/calculate.js";
import { processFifo } from "../src/fifo.js";

// ---------------------------------------------------------------------------
// Helper — build an enriched Transaction with PLN = original (fxRate = 1)
// ---------------------------------------------------------------------------

let _seq = 0;
function makeTx(
  overrides: Partial<Transaction> & Pick<Transaction, "type" | "date" | "symbol">,
): Transaction {
  const id = `tx-${++_seq}`;
  const grossAmount = overrides.grossAmount ?? new Decimal(0);
  const commission = overrides.commission ?? new Decimal(0);
  const quantity = overrides.quantity;

  // netAmount: BUY = gross + commission, SELL = gross - commission, others = gross
  let netAmount: Decimal;
  if (overrides.netAmount !== undefined) {
    netAmount = overrides.netAmount;
  } else if (overrides.type === "BUY") {
    netAmount = grossAmount.add(commission);
  } else if (overrides.type === "SELL") {
    netAmount = grossAmount.sub(commission);
  } else {
    netAmount = grossAmount;
  }

  return {
    id,
    broker: "test",
    currency: "PLN",
    grossAmount,
    commission,
    netAmount,
    // PLN fields (fxRate = 1)
    fxRate: new Decimal(1),
    fxDate: overrides.date,
    grossAmountPLN: grossAmount,
    commissionPLN: commission,
    netAmountPLN: netAmount,
    // spread any overrides (including quantity, symbol, type, date, etc.)
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1 — Single-year equity, gain
// ---------------------------------------------------------------------------

describe("Scenario 1 — equity gain", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "BUY",
      date: "2023-01-10",
      symbol: "XYZ",
      quantity: new Decimal(10),
      grossAmount: new Decimal(1000),
      commission: new Decimal(0),
    }),
    makeTx({
      type: "SELL",
      date: "2023-06-15",
      symbol: "XYZ",
      quantity: new Decimal(10),
      grossAmount: new Decimal(1500),
      commission: new Decimal(10),
    }),
  ];

  it("produces correct equity summary", () => {
    const result = calculateTax(txs);
    const summary2023 = result.get(2023)!;
    expect(summary2023).toBeDefined();

    const eq = summary2023.equity;
    expect(eq.totalRevenuePLN.toNumber()).toBe(1500);
    // cost = costBasis (1000) + commissionSell (10) = 1010
    expect(eq.totalCostPLN.toNumber()).toBe(1010);
    expect(eq.totalGainLossPLN.toNumber()).toBe(490);
    expect(eq.taxBase.toNumber()).toBe(490);
    // 490 × 0.19 = 93.1
    expect(eq.taxDue.toNumber()).toBeCloseTo(93.1);
  });

  it("totalTaxDue equals equity taxDue when no dividends", () => {
    const result = calculateTax(txs);
    const s = result.get(2023)!;
    expect(s.totalTaxDue.toNumber()).toBeCloseTo(s.equity.taxDue.toNumber());
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Single-year equity, loss (no tax)
// ---------------------------------------------------------------------------

describe("Scenario 2 — equity loss produces zero tax", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "BUY",
      date: "2023-01-10",
      symbol: "ABC",
      quantity: new Decimal(10),
      grossAmount: new Decimal(2000),
    }),
    makeTx({
      type: "SELL",
      date: "2023-09-01",
      symbol: "ABC",
      quantity: new Decimal(10),
      grossAmount: new Decimal(1000),
    }),
  ];

  it("taxBase = 0 and taxDue = 0 on a loss year", () => {
    const result = calculateTax(txs);
    const eq = result.get(2023)!.equity;
    expect(eq.totalGainLossPLN.toNumber()).toBe(-1000);
    expect(eq.taxBase.toNumber()).toBe(0);
    expect(eq.taxDue.toNumber()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Multi-year (buy 2022, sell 2023)
// ---------------------------------------------------------------------------

describe("Scenario 3 — cross-year lot", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "BUY",
      date: "2022-03-01",
      symbol: "DEF",
      quantity: new Decimal(5),
      grossAmount: new Decimal(500),
    }),
    makeTx({
      type: "SELL",
      date: "2023-04-01",
      symbol: "DEF",
      quantity: new Decimal(5),
      grossAmount: new Decimal(800),
    }),
  ];

  it("no 2022 entry (no sells that year)", () => {
    const result = calculateTax(txs);
    expect(result.has(2022)).toBe(false);
  });

  it("2023 has the correct gain", () => {
    const result = calculateTax(txs);
    const eq = result.get(2023)!.equity;
    expect(eq.totalRevenuePLN.toNumber()).toBe(800);
    expect(eq.totalCostPLN.toNumber()).toBe(500);
    expect(eq.totalGainLossPLN.toNumber()).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Dividend + full withholding credit
// ---------------------------------------------------------------------------

describe("Scenario 4 — dividend, full WHT credit", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "DIVIDEND",
      date: "2023-05-10",
      symbol: "ABBV",
      grossAmount: new Decimal(100),
    }),
    makeTx({
      type: "WITHHOLDING_TAX",
      date: "2023-05-10",
      symbol: "ABBV",
      grossAmount: new Decimal(19),
    }),
  ];

  it("taxDue = 0 when WHT covers full Polish tax", () => {
    const result = calculateTax(txs);
    const div = result.get(2023)!.dividends;
    expect(div.grossDividendsPLN.toNumber()).toBe(100);
    expect(div.polishTaxGross.toNumber()).toBeCloseTo(19);
    expect(div.taxCredit.toNumber()).toBeCloseTo(19);
    expect(div.taxDue.toNumber()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Dividend + partial withholding credit
// ---------------------------------------------------------------------------

describe("Scenario 5 — dividend, partial WHT credit", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "DIVIDEND",
      date: "2023-07-01",
      symbol: "MSFT",
      grossAmount: new Decimal(100),
    }),
    makeTx({
      type: "WITHHOLDING_TAX",
      date: "2023-07-01",
      symbol: "MSFT",
      grossAmount: new Decimal(10),
    }),
  ];

  it("taxDue = polishTaxGross - WHT = 9", () => {
    const result = calculateTax(txs);
    const div = result.get(2023)!.dividends;
    expect(div.polishTaxGross.toNumber()).toBeCloseTo(19);
    expect(div.taxCredit.toNumber()).toBe(10);
    expect(div.taxDue.toNumber()).toBeCloseTo(9);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — Dividend + no WHT
// ---------------------------------------------------------------------------

describe("Scenario 6 — dividend, no WHT", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "DIVIDEND",
      date: "2023-08-15",
      symbol: "AAPL",
      grossAmount: new Decimal(100),
    }),
  ];

  it("taxDue = 19 PLN", () => {
    const result = calculateTax(txs);
    const div = result.get(2023)!.dividends;
    expect(div.taxCredit.toNumber()).toBe(0);
    expect(div.taxDue.toNumber()).toBeCloseTo(19);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — WHT with different date than dividend (unmatched)
// ---------------------------------------------------------------------------

describe("Scenario 7 — unmatched WHT date", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "DIVIDEND",
      date: "2023-09-01",
      symbol: "BA",
      grossAmount: new Decimal(100),
    }),
    makeTx({
      type: "WITHHOLDING_TAX",
      date: "2023-09-05", // different date
      symbol: "BA",
      grossAmount: new Decimal(15),
    }),
  ];

  it("dividend withholdingTaxPLN = 0 (no match)", () => {
    const items = matchDividendsWithholding(txs);
    expect(items).toHaveLength(1);
    expect(items[0]!.withholdingTaxPLN.toNumber()).toBe(0);
  });

  it("does not crash", () => {
    expect(() => calculateTax(txs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 — Stock split end-to-end through calculateTax
// ---------------------------------------------------------------------------

describe("Scenario 8 — stock split", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "BUY",
      date: "2023-01-10",
      symbol: "NVDA",
      quantity: new Decimal(5),
      grossAmount: new Decimal(5000),
      commission: new Decimal(0),
    }),
    // 10:1 split → 5 shares become 50 shares, costPerShare: 1000 → 100
    makeTx({
      type: "STOCK_SPLIT",
      date: "2023-06-01",
      symbol: "NVDA",
      quantity: new Decimal(10), // ratio = 10
      grossAmount: new Decimal(0),
      commission: new Decimal(0),
    }),
    makeTx({
      type: "SELL",
      date: "2023-09-15",
      symbol: "NVDA",
      quantity: new Decimal(50),
      grossAmount: new Decimal(6000),
      commission: new Decimal(0),
    }),
  ];

  it("equity: revenue=6000, costBasis=5000, gain=1000, taxDue=190", () => {
    const result = calculateTax(txs);
    const eq = result.get(2023)!.equity;
    expect(eq.totalRevenuePLN.toNumber()).toBe(6000);
    expect(eq.totalCostPLN.toNumber()).toBe(5000);
    expect(eq.totalGainLossPLN.toNumber()).toBe(1000);
    expect(eq.taxDue.toNumber()).toBeCloseTo(190);
  });
});

// ---------------------------------------------------------------------------
// Scenario 9 — Multiple years, year-isolated numbers
// ---------------------------------------------------------------------------

describe("Scenario 9 — multiple sell years", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "BUY",
      date: "2021-01-10",
      symbol: "GHI",
      quantity: new Decimal(20),
      grossAmount: new Decimal(2000),
    }),
    makeTx({
      type: "SELL",
      date: "2022-03-01",
      symbol: "GHI",
      quantity: new Decimal(10),
      grossAmount: new Decimal(1200),
    }),
    makeTx({
      type: "SELL",
      date: "2024-07-01",
      symbol: "GHI",
      quantity: new Decimal(10),
      grossAmount: new Decimal(1800),
    }),
  ];

  it("map has exactly two entries: 2022 and 2024", () => {
    const result = calculateTax(txs);
    expect([...result.keys()].sort()).toEqual([2022, 2024]);
  });

  it("2022: costBasis = 1000 (half of 2000), revenue = 1200", () => {
    const eq2022 = calculateTax(txs).get(2022)!.equity;
    expect(eq2022.totalRevenuePLN.toNumber()).toBe(1200);
    expect(eq2022.totalCostPLN.toNumber()).toBe(1000);
    expect(eq2022.totalGainLossPLN.toNumber()).toBe(200);
  });

  it("2024: costBasis = 1000 (remaining half), revenue = 1800", () => {
    const eq2024 = calculateTax(txs).get(2024)!.equity;
    expect(eq2024.totalRevenuePLN.toNumber()).toBe(1800);
    expect(eq2024.totalCostPLN.toNumber()).toBe(1000);
    expect(eq2024.totalGainLossPLN.toNumber()).toBe(800);
  });

  it("each year's matches contains only that year's sell", () => {
    const result = calculateTax(txs);
    expect(result.get(2022)!.equity.matches).toHaveLength(1);
    expect(result.get(2024)!.equity.matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 10 — computeEquitySummary / computeDividendSummary unit tests
// ---------------------------------------------------------------------------

describe("computeEquitySummary — empty year", () => {
  it("returns zero summary for a year with no matches", () => {
    const result = computeEquitySummary([], 2023);
    expect(result.totalRevenuePLN.toNumber()).toBe(0);
    expect(result.totalCostPLN.toNumber()).toBe(0);
    expect(result.taxDue.toNumber()).toBe(0);
    expect(result.matches).toHaveLength(0);
  });
});

describe("computeDividendSummary — multiple WHT on same symbol+date", () => {
  // Two WHT transactions on the same key should sum
  const txs: Transaction[] = [
    makeTx({
      type: "DIVIDEND",
      date: "2023-11-01",
      symbol: "JNJ",
      grossAmount: new Decimal(200),
    }),
    makeTx({
      type: "WITHHOLDING_TAX",
      date: "2023-11-01",
      symbol: "JNJ",
      grossAmount: new Decimal(20),
    }),
    makeTx({
      type: "WITHHOLDING_TAX",
      date: "2023-11-01",
      symbol: "JNJ",
      grossAmount: new Decimal(18),
    }),
  ];

  it("sums multiple WHT rows for the same symbol+date", () => {
    const items = matchDividendsWithholding(txs);
    expect(items[0]!.withholdingTaxPLN.toNumber()).toBe(38);
  });
});

// ---------------------------------------------------------------------------
// Scenario 11 — includeOtherIncome option
// ---------------------------------------------------------------------------

describe("includeOtherIncome = false (default)", () => {
  const txs: Transaction[] = [
    makeTx({
      type: "OTHER_INCOME",
      date: "2023-03-01",
      symbol: "INTEREST",
      grossAmount: new Decimal(500),
    }),
    makeTx({
      type: "FEE",
      date: "2023-03-01",
      symbol: "FEE",
      grossAmount: new Decimal(100),
    }),
  ];

  it("no years produced when only OTHER_INCOME/FEE (default)", () => {
    const result = calculateTax(txs);
    expect(result.size).toBe(0);
  });

  it("year produced and taxDue calculated when includeOtherIncome=true", () => {
    const result = calculateTax(txs, { includeOtherIncome: true });
    const other = result.get(2023)!.otherIncome;
    expect(other.totalIncomePLN.toNumber()).toBe(500);
    expect(other.totalCostPLN.toNumber()).toBe(100);
    expect(other.gainLossPLN.toNumber()).toBe(400);
    expect(other.taxDue.toNumber()).toBeCloseTo(76);
  });
});

// ---------------------------------------------------------------------------
// Scenario 12 — processFifo called once across all years
// ---------------------------------------------------------------------------

describe("FIFO runs across year boundary (cross-year lot integrity)", () => {
  // Buy in 2022, partial sell in 2022, remaining sell in 2023.
  // Total cost should be evenly split.
  const txs: Transaction[] = [
    makeTx({
      type: "BUY",
      date: "2022-01-10",
      symbol: "KLM",
      quantity: new Decimal(100),
      grossAmount: new Decimal(10000),
    }),
    makeTx({
      type: "SELL",
      date: "2022-11-01",
      symbol: "KLM",
      quantity: new Decimal(40),
      grossAmount: new Decimal(5000),
    }),
    makeTx({
      type: "SELL",
      date: "2023-02-01",
      symbol: "KLM",
      quantity: new Decimal(60),
      grossAmount: new Decimal(9000),
    }),
  ];

  it("2022 costBasis = 4000 (40% of 10000)", () => {
    const result = calculateTax(txs);
    expect(result.get(2022)!.equity.totalCostPLN.toNumber()).toBe(4000);
  });

  it("2023 costBasis = 6000 (60% of 10000)", () => {
    const result = calculateTax(txs);
    expect(result.get(2023)!.equity.totalCostPLN.toNumber()).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// Loss carry-forward scenarios (lossCarryForward: true)
// ---------------------------------------------------------------------------

describe("lossCarryForward — basic: loss year then gain year", () => {
  // 2021: buy 10 @ 200 = 2000, sell 10 @ 100 = 1000 → loss -1000
  // 2022: buy 10 @ 100 = 1000, sell 10 @ 200 = 2000 → raw gain +1000
  // With carry: max deductible from 2021 loss = 50% of 1000 = 500
  //   → taxBase 2022 = 1000 - 500 = 500, taxDue = 95
  const txs: Transaction[] = [
    makeTx({ type: "BUY",  date: "2021-01-10", symbol: "LCF", quantity: new Decimal(10), grossAmount: new Decimal(2000) }),
    makeTx({ type: "SELL", date: "2021-12-01", symbol: "LCF", quantity: new Decimal(10), grossAmount: new Decimal(1000) }),
    makeTx({ type: "BUY",  date: "2022-01-10", symbol: "LCF", quantity: new Decimal(10), grossAmount: new Decimal(1000) }),
    makeTx({ type: "SELL", date: "2022-12-01", symbol: "LCF", quantity: new Decimal(10), grossAmount: new Decimal(2000) }),
  ];

  it("without carry-forward: 2021 taxDue=0, 2022 taxBase=1000", () => {
    const result = calculateTax(txs);
    expect(result.get(2021)!.equity.taxDue.toNumber()).toBe(0);
    expect(result.get(2022)!.equity.taxBase.toNumber()).toBe(1000);
  });

  it("with carry-forward: 2021 taxDue=0, 2022 deducts 500, taxBase=500", () => {
    const result = calculateTax(txs, { lossCarryForward: true });
    const eq2021 = result.get(2021)!.equity;
    const eq2022 = result.get(2022)!.equity;
    expect(eq2021.taxDue.toNumber()).toBe(0);
    expect(eq2022.lossCarryForwardDeducted.toNumber()).toBe(500);
    expect(eq2022.taxBase.toNumber()).toBe(500);
    expect(eq2022.taxDue.toNumber()).toBeCloseTo(95);
  });
});

describe("lossCarryForward — loss fully absorbed over 2 gain years", () => {
  // 2020: loss -10000
  // 2021: gain +8000 → deduct min(5000, 8000) = 5000 → taxBase 3000
  // 2022: gain +8000 → deduct min(5000, 5000 remaining) = 5000 → taxBase 3000
  const txs: Transaction[] = [
    makeTx({ type: "BUY",  date: "2020-01-10", symbol: "A", quantity: new Decimal(10), grossAmount: new Decimal(10000) }),
    makeTx({ type: "SELL", date: "2020-12-01", symbol: "A", quantity: new Decimal(10), grossAmount: new Decimal(0),    netAmount: new Decimal(0) }),
    makeTx({ type: "BUY",  date: "2021-01-10", symbol: "A", quantity: new Decimal(10), grossAmount: new Decimal(1000) }),
    makeTx({ type: "SELL", date: "2021-12-01", symbol: "A", quantity: new Decimal(10), grossAmount: new Decimal(9000) }),
    makeTx({ type: "BUY",  date: "2022-01-10", symbol: "A", quantity: new Decimal(10), grossAmount: new Decimal(1000) }),
    makeTx({ type: "SELL", date: "2022-12-01", symbol: "A", quantity: new Decimal(10), grossAmount: new Decimal(9000) }),
  ];

  it("2021: deducts 5000, taxBase = 3000", () => {
    const result = calculateTax(txs, { lossCarryForward: true });
    const eq = result.get(2021)!.equity;
    expect(eq.lossCarryForwardDeducted.toNumber()).toBe(5000);
    expect(eq.taxBase.toNumber()).toBe(3000);
  });

  it("2022: deducts remaining 5000, taxBase = 3000", () => {
    const result = calculateTax(txs, { lossCarryForward: true });
    const eq = result.get(2022)!.equity;
    expect(eq.lossCarryForwardDeducted.toNumber()).toBe(5000);
    expect(eq.taxBase.toNumber()).toBe(3000);
  });
});

describe("lossCarryForward — 5-year expiry", () => {
  // Loss in 2018, gain in 2024 — more than 5 years later, no carry allowed.
  const txs: Transaction[] = [
    makeTx({ type: "BUY",  date: "2018-01-10", symbol: "B", quantity: new Decimal(10), grossAmount: new Decimal(5000) }),
    makeTx({ type: "SELL", date: "2018-12-01", symbol: "B", quantity: new Decimal(10), grossAmount: new Decimal(1000) }),
    makeTx({ type: "BUY",  date: "2024-01-10", symbol: "B", quantity: new Decimal(10), grossAmount: new Decimal(500) }),
    makeTx({ type: "SELL", date: "2024-12-01", symbol: "B", quantity: new Decimal(10), grossAmount: new Decimal(2000) }),
  ];

  it("2024 carry deducted = 0 (loss expired)", () => {
    const result = calculateTax(txs, { lossCarryForward: true });
    const eq = result.get(2024)!.equity;
    expect(eq.lossCarryForwardDeducted.toNumber()).toBe(0);
    expect(eq.taxBase.toNumber()).toBe(1500); // full gain
  });
});

describe("lossCarryForward — multiple prior losses, oldest applied first", () => {
  // 2021: loss -6000
  // 2022: loss -4000
  // 2023: gain +8000
  //   From 2021: cap = 3000 (50% of 6000), deduct 3000
  //   From 2022: cap = 2000 (50% of 4000), deduct 2000
  //   Total deducted = 5000, taxBase = 3000
  const txs: Transaction[] = [
    makeTx({ type: "BUY",  date: "2021-01-10", symbol: "C", quantity: new Decimal(10), grossAmount: new Decimal(6000) }),
    makeTx({ type: "SELL", date: "2021-12-01", symbol: "C", quantity: new Decimal(10), grossAmount: new Decimal(0),    netAmount: new Decimal(0) }),
    makeTx({ type: "BUY",  date: "2022-01-10", symbol: "C", quantity: new Decimal(10), grossAmount: new Decimal(4000) }),
    makeTx({ type: "SELL", date: "2022-12-01", symbol: "C", quantity: new Decimal(10), grossAmount: new Decimal(0),    netAmount: new Decimal(0) }),
    makeTx({ type: "BUY",  date: "2023-01-10", symbol: "C", quantity: new Decimal(10), grossAmount: new Decimal(1000) }),
    makeTx({ type: "SELL", date: "2023-12-01", symbol: "C", quantity: new Decimal(10), grossAmount: new Decimal(9000) }),
  ];

  it("2023: deducts 5000 (3000 from 2021 + 2000 from 2022), taxBase = 3000", () => {
    const result = calculateTax(txs, { lossCarryForward: true });
    const eq = result.get(2023)!.equity;
    expect(eq.lossCarryForwardDeducted.toNumber()).toBe(5000);
    expect(eq.taxBase.toNumber()).toBe(3000);
  });
});

describe("lossCarryForward — lossCarryForwardDeducted = 0 by default", () => {
  const txs: Transaction[] = [
    makeTx({ type: "BUY",  date: "2023-01-10", symbol: "D", quantity: new Decimal(10), grossAmount: new Decimal(1000) }),
    makeTx({ type: "SELL", date: "2023-12-01", symbol: "D", quantity: new Decimal(10), grossAmount: new Decimal(2000) }),
  ];

  it("lossCarryForwardDeducted is always present and = 0 when not used", () => {
    const eq = calculateTax(txs).get(2023)!.equity;
    expect(eq.lossCarryForwardDeducted.toNumber()).toBe(0);
  });
});
