import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { processFifo } from "../src/fifo.js";
import type { Transaction } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a PLN-denominated Transaction (fxRate = 1, no FX conversion needed).
 * commission defaults to 0.
 */
function makePlnTx(opts: {
  id: string;
  date: string;
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  commission?: number;
}): Transaction {
  const qty = new Decimal(opts.quantity);
  const price = new Decimal(opts.price);
  const comm = new Decimal(opts.commission ?? 0);
  const gross = qty.mul(price);
  const net = opts.type === "BUY" ? gross.add(comm) : gross.sub(comm);
  const ONE = new Decimal(1);

  return {
    id: opts.id,
    broker: "test",
    date: opts.date,
    type: opts.type,
    symbol: opts.symbol,
    quantity: qty,
    pricePerShare: price,
    currency: "PLN",
    grossAmount: gross,
    commission: comm,
    netAmount: net,
    fxRate: ONE,
    fxDate: opts.date,
    grossAmountPLN: gross,
    commissionPLN: comm,
    netAmountPLN: net,
  };
}

/** Compare a Decimal to an expected number at 2-decimal-place precision. */
function expectPLN(actual: Decimal, expected: number, label = ""): void {
  expect(actual.toFixed(2), label).toBe(new Decimal(expected).toFixed(2));
}

// ---------------------------------------------------------------------------
// Golden Scenario 1 — Simple PLN equity, buy and sell same year
//
// Buy:  100 shares CDPROJKT @ 250.00 PLN  (2024-03-01)
// Sell: 100 shares CDPROJKT @ 310.00 PLN  (2024-11-15)
//
// Revenue:    31,000.00 PLN
// Cost basis: 25,000.00 PLN
// Net gain:    6,000.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 1: simple PLN equity, buy and sell same year", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-03-01",
      type: "BUY",
      symbol: "CDPROJKT",
      quantity: 100,
      price: 250,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-11-15",
      type: "SELL",
      symbol: "CDPROJKT",
      quantity: 100,
      price: 310,
    }),
  ];

  it("produces one match", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 31_000, "revenue");
    expectPLN(m.costBasisPLN, 25_000, "cost basis");
    expectPLN(m.commissionSellPLN, 0, "sell commission");
    expectPLN(m.gainLossPLN, 6_000, "gain");
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });

  it("matched one lot — the single buy", () => {
    const { matches } = processFifo(txs);
    expect(matches[0]!.lots).toHaveLength(1);
    expectPLN(matches[0]!.lots[0]!.quantityConsumed, 100);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 2 — Two lots, sell exactly the first lot
//
// Buy:  60 shares @ 40.00 PLN  (lot 1, 2024-01-10)
// Buy:  40 shares @ 60.00 PLN  (lot 2, 2024-04-20)
// Sell: 60 shares @ 80.00 PLN  (2024-11-05)
//
// FIFO:   60 from lot 1 (fully consumed)
// Cost:   2,400.00 PLN
// Revenue: 4,800.00 PLN
// Gain:    2,400.00 PLN
// Remaining: lot 2 — 40 shares @ 60.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 2: two lots, sell exactly the first lot", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-10",
      type: "BUY",
      symbol: "ABC",
      quantity: 60,
      price: 40,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-04-20",
      type: "BUY",
      symbol: "ABC",
      quantity: 40,
      price: 60,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-11-05",
      type: "SELL",
      symbol: "ABC",
      quantity: 60,
      price: 80,
    }),
  ];

  it("produces one match consuming only lot 1", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lots).toHaveLength(1);
    expectPLN(matches[0]!.lots[0]!.quantityConsumed, 60);
    expectPLN(matches[0]!.lots[0]!.costPLN, 2_400);
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 4_800, "revenue");
    expectPLN(m.costBasisPLN, 2_400, "cost basis");
    expectPLN(m.gainLossPLN, 2_400, "gain");
  });

  it("leaves lot 2 intact with 40 shares @ 60", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    expectPLN(remainingLots[0]!.remainingQuantity, 40, "remaining qty");
    expectPLN(remainingLots[0]!.costPerSharePLN, 60, "cost/share");
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 3 — Two lots, partial sell crosses lot boundary
//
// Buy:  50 shares @ 100.00 PLN  (lot 1, 2024-01-10)
// Buy:  50 shares @ 120.00 PLN  (lot 2, 2024-03-15)
// Sell: 70 shares @ 150.00 PLN  (2024-10-20)
//
// FIFO:   50 from lot 1 + 20 from lot 2
// Cost:   5,000 + 2,400 = 7,400.00 PLN
// Revenue: 10,500.00 PLN
// Gain:     3,100.00 PLN
// Remaining: lot 2 — 30 shares @ 120.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 3: two lots, partial sell crosses lot boundary", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-10",
      type: "BUY",
      symbol: "XYZ",
      quantity: 50,
      price: 100,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-03-15",
      type: "BUY",
      symbol: "XYZ",
      quantity: 50,
      price: 120,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-10-20",
      type: "SELL",
      symbol: "XYZ",
      quantity: 70,
      price: 150,
    }),
  ];

  it("produces one match consuming both lots", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lots).toHaveLength(2);
  });

  it("allocates 50 from lot 1 and 20 from lot 2", () => {
    const { matches } = processFifo(txs);
    const [l1, l2] = matches[0]!.lots;
    expectPLN(l1!.quantityConsumed, 50, "lot1 qty");
    expectPLN(l1!.costPLN, 5_000, "lot1 cost");
    expectPLN(l2!.quantityConsumed, 20, "lot2 qty");
    expectPLN(l2!.costPLN, 2_400, "lot2 cost");
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 10_500, "revenue");
    expectPLN(m.costBasisPLN, 7_400, "cost basis");
    expectPLN(m.gainLossPLN, 3_100, "gain");
  });

  it("leaves 30 shares remaining in lot 2 @ 120", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    expectPLN(remainingLots[0]!.remainingQuantity, 30, "remaining qty");
    expectPLN(remainingLots[0]!.costPerSharePLN, 120, "cost/share");
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 4 — Two lots, sell all shares from both lots
//
// Buy:   60 shares @ 40.00 PLN  (lot 1, 2024-01-10)
// Buy:   40 shares @ 60.00 PLN  (lot 2, 2024-04-20)
// Sell: 100 shares @ 80.00 PLN  (2024-11-05)
//
// Cost:    2,400 + 2,400 = 4,800.00 PLN
// Revenue: 8,000.00 PLN
// Gain:    3,200.00 PLN
// Remaining: none
// ---------------------------------------------------------------------------
describe("Scenario 4: two lots, sell all shares from both lots", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-10",
      type: "BUY",
      symbol: "ABC",
      quantity: 60,
      price: 40,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-04-20",
      type: "BUY",
      symbol: "ABC",
      quantity: 40,
      price: 60,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-11-05",
      type: "SELL",
      symbol: "ABC",
      quantity: 100,
      price: 80,
    }),
  ];

  it("produces one match consuming both lots fully", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lots).toHaveLength(2);
    expectPLN(matches[0]!.lots[0]!.quantityConsumed, 60);
    expectPLN(matches[0]!.lots[1]!.quantityConsumed, 40);
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 8_000, "revenue");
    expectPLN(m.costBasisPLN, 4_800, "cost basis");
    expectPLN(m.gainLossPLN, 3_200, "gain");
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 5 — Three lots, sell spans all three
//
// Buy:  30 shares @ 50.00 PLN  (lot 1, 2024-01-05)
// Buy:  30 shares @ 70.00 PLN  (lot 2, 2024-03-10)
// Buy:  40 shares @ 90.00 PLN  (lot 3, 2024-06-01)
// Sell: 80 shares @ 110.00 PLN (2024-12-01)
//
// FIFO:   30 from lot 1 + 30 from lot 2 + 20 from lot 3
// Cost:   1,500 + 2,100 + 1,800 = 5,400.00 PLN
// Revenue: 8,800.00 PLN
// Gain:    3,400.00 PLN
// Remaining: lot 3 — 20 shares @ 90.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 5: three lots, sell spans all three", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-05",
      type: "BUY",
      symbol: "DEF",
      quantity: 30,
      price: 50,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-03-10",
      type: "BUY",
      symbol: "DEF",
      quantity: 30,
      price: 70,
    }),
    makePlnTx({
      id: "b3",
      date: "2024-06-01",
      type: "BUY",
      symbol: "DEF",
      quantity: 40,
      price: 90,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-12-01",
      type: "SELL",
      symbol: "DEF",
      quantity: 80,
      price: 110,
    }),
  ];

  it("produces one match consuming three lots", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lots).toHaveLength(3);
  });

  it("allocates 30 / 30 / 20 across the three lots", () => {
    const { matches } = processFifo(txs);
    const [l1, l2, l3] = matches[0]!.lots;
    expectPLN(l1!.quantityConsumed, 30);
    expectPLN(l1!.costPLN, 1_500);
    expectPLN(l2!.quantityConsumed, 30);
    expectPLN(l2!.costPLN, 2_100);
    expectPLN(l3!.quantityConsumed, 20);
    expectPLN(l3!.costPLN, 1_800);
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 8_800, "revenue");
    expectPLN(m.costBasisPLN, 5_400, "cost basis");
    expectPLN(m.gainLossPLN, 3_400, "gain");
  });

  it("leaves 20 shares remaining in lot 3 @ 90", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    expectPLN(remainingLots[0]!.remainingQuantity, 20);
    expectPLN(remainingLots[0]!.costPerSharePLN, 90);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 6 — Two sequential sells deplete lots in order
//
// Buy:  50 shares @ 100.00 PLN  (lot 1, 2024-01-10)
// Buy:  50 shares @ 120.00 PLN  (lot 2, 2024-03-15)
// Sell: 50 shares @ 140.00 PLN  (sell 1, 2024-07-01) → consumes lot 1
// Sell: 50 shares @ 160.00 PLN  (sell 2, 2024-11-20) → consumes lot 2
//
// Sell 1: revenue 7,000 / cost 5,000 / gain 2,000
// Sell 2: revenue 8,000 / cost 6,000 / gain 2,000
// Annual: revenue 15,000 / cost 11,000 / gain 4,000
// ---------------------------------------------------------------------------
describe("Scenario 6: two sequential sells deplete lots in order", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-10",
      type: "BUY",
      symbol: "GHI",
      quantity: 50,
      price: 100,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-03-15",
      type: "BUY",
      symbol: "GHI",
      quantity: 50,
      price: 120,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-07-01",
      type: "SELL",
      symbol: "GHI",
      quantity: 50,
      price: 140,
    }),
    makePlnTx({
      id: "s2",
      date: "2024-11-20",
      type: "SELL",
      symbol: "GHI",
      quantity: 50,
      price: 160,
    }),
  ];

  it("produces two matches", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(2);
  });

  it("sell 1 consumes lot 1 entirely", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expect(m.lots).toHaveLength(1);
    expectPLN(m.lots[0]!.quantityConsumed, 50);
    expectPLN(m.revenueGrossPLN, 7_000, "revenue sell 1");
    expectPLN(m.costBasisPLN, 5_000, "cost sell 1");
    expectPLN(m.gainLossPLN, 2_000, "gain sell 1");
  });

  it("sell 2 consumes lot 2 entirely", () => {
    const { matches } = processFifo(txs);
    const m = matches[1]!;
    expect(m.lots).toHaveLength(1);
    expectPLN(m.lots[0]!.quantityConsumed, 50);
    expectPLN(m.revenueGrossPLN, 8_000, "revenue sell 2");
    expectPLN(m.costBasisPLN, 6_000, "cost sell 2");
    expectPLN(m.gainLossPLN, 2_000, "gain sell 2");
  });

  it("aggregate annual gain is 4,000", () => {
    const { matches } = processFifo(txs);
    const totalGain = matches.reduce((acc, m) => acc.add(m.gainLossPLN), new Decimal(0));
    expectPLN(totalGain, 4_000, "total annual gain");
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 7 — Sell at a loss
//
// Buy:  100 shares @ 200.00 PLN  (2024-02-01)
// Sell: 100 shares @ 150.00 PLN  (2024-09-15)
//
// Revenue:  15,000.00 PLN
// Cost:     20,000.00 PLN
// Net loss:  -5,000.00 PLN  (no tax due; loss offsets other gains in the year)
// ---------------------------------------------------------------------------
describe("Scenario 7: sell at a loss", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-02-01",
      type: "BUY",
      symbol: "LOSS",
      quantity: 100,
      price: 200,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-09-15",
      type: "SELL",
      symbol: "LOSS",
      quantity: 100,
      price: 150,
    }),
  ];

  it("produces a negative gainLossPLN", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expectPLN(matches[0]!.revenueGrossPLN, 15_000, "revenue");
    expectPLN(matches[0]!.costBasisPLN, 20_000, "cost");
    expectPLN(matches[0]!.gainLossPLN, -5_000, "loss");
  });

  it("gain is negative (a loss)", () => {
    const { matches } = processFifo(txs);
    expect(matches[0]!.gainLossPLN.isNegative()).toBe(true);
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 8 — Interleaved buys and sells, partial lot carry-over
//
// Buy:  40 shares @ 80.00 PLN  (lot 1, 2024-01-15)
// Sell: 25 shares @ 100.00 PLN (sell 1, 2024-04-10)  ← 25 from lot 1
// Buy:  30 shares @ 90.00 PLN  (lot 2, 2024-05-20)   ← lot 1 now has 15 remaining
// Sell: 35 shares @ 110.00 PLN (sell 2, 2024-10-05)  ← 15 from lot 1 + 20 from lot 2
//
// Sell 1: revenue 2,500 / cost 2,000 / gain 500
// Sell 2: revenue 3,850 / cost 3,000 / gain 850
// Annual: revenue 6,350 / cost 5,000 / gain 1,350
// Remaining: lot 2 — 10 shares @ 90.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 8: interleaved buys and sells with partial lot carry-over", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-15",
      type: "BUY",
      symbol: "JKL",
      quantity: 40,
      price: 80,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-04-10",
      type: "SELL",
      symbol: "JKL",
      quantity: 25,
      price: 100,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-05-20",
      type: "BUY",
      symbol: "JKL",
      quantity: 30,
      price: 90,
    }),
    makePlnTx({
      id: "s2",
      date: "2024-10-05",
      type: "SELL",
      symbol: "JKL",
      quantity: 35,
      price: 110,
    }),
  ];

  it("produces two matches", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(2);
  });

  it("sell 1: 25 shares from lot 1 only", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expect(m.lots).toHaveLength(1);
    expectPLN(m.lots[0]!.quantityConsumed, 25, "qty from lot1");
    expectPLN(m.lots[0]!.costPLN, 2_000, "cost from lot1");
    expectPLN(m.revenueGrossPLN, 2_500, "revenue sell1");
    expectPLN(m.costBasisPLN, 2_000, "cost sell1");
    expectPLN(m.gainLossPLN, 500, "gain sell1");
  });

  it("sell 2: 15 from lot 1 remainder + 20 from lot 2", () => {
    const { matches } = processFifo(txs);
    const m = matches[1]!;
    expect(m.lots).toHaveLength(2);
    expectPLN(m.lots[0]!.quantityConsumed, 15, "qty from lot1 remainder");
    expectPLN(m.lots[0]!.costPLN, 1_200, "cost from lot1 remainder");
    expectPLN(m.lots[1]!.quantityConsumed, 20, "qty from lot2");
    expectPLN(m.lots[1]!.costPLN, 1_800, "cost from lot2");
    expectPLN(m.revenueGrossPLN, 3_850, "revenue sell2");
    expectPLN(m.costBasisPLN, 3_000, "cost sell2");
    expectPLN(m.gainLossPLN, 850, "gain sell2");
  });

  it("aggregate annual gain is 1,350", () => {
    const { matches } = processFifo(txs);
    const totalGain = matches.reduce((acc, m) => acc.add(m.gainLossPLN), new Decimal(0));
    expectPLN(totalGain, 1_350, "total annual gain");
  });

  it("leaves 10 shares remaining in lot 2 @ 90", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    expectPLN(remainingLots[0]!.remainingQuantity, 10, "remaining qty");
    expectPLN(remainingLots[0]!.costPerSharePLN, 90, "cost/share");
  });
});

// ---------------------------------------------------------------------------
// Real-world Scenario — IBKR NVDA trades with USD→PLN FX conversion
//
// Source: IBKR activity statement (U***0450)
//   Buy:  10 shares NVDA @ $136.82    on 2022-09-02  (NBP T-1 date 2022-09-01, rate 4.6959)
//   Buy:   7 shares NVDA @ $438.61    on 2023-08-02  (NBP T-1 date 2023-08-01, rate 4.0262)
//   Sell:  5 shares NVDA @ $1,814.00  on 2025-11-26  (NBP T-1 date 2025-11-25, rate 3.6675)
//
// FIFO: 5 shares consumed from Lot 1 (2022-09-02 buy); Lot 2 untouched.
//
// Expected (engine formula, commissions included per PIT-38 rules):
//   Lot 1 cost/share PLN = netAmountPLN / qty = (1368.55 × 4.6959) / 10 = 642.6574
//   Revenue PLN          = 9070.00 × 3.6675               = 33,264.23
//   Sell commission PLN  = 0.52 × 3.6675                  =      1.91
//   Cost basis PLN       = 5 × 642.6574                   =  3,213.29
//   Gain/loss PLN        = 33,264.23 − 1.91 − 3,213.29   = 30,049.03
//
// Note: manual estimate (gross revenue − gross cost, no commissions) = 30,051.76 PLN.
//       The 30,052.85 figure from manual lookup has a small rounding discrepancy.
// ---------------------------------------------------------------------------

/**
 * Builds a USD-denominated Transaction with pre-computed PLN fields using a
 * provided NBP fx rate (T-1 rule already applied by caller).
 */
function makeUsdTx(opts: {
  id: string;
  date: string;
  fxDate: string;
  fxRate: number;
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  pricePerShare: number;
  grossAmountUSD: number;
  commissionUSD: number;
}): Transaction {
  const qty = new Decimal(opts.quantity);
  const price = new Decimal(opts.pricePerShare);
  const gross = new Decimal(opts.grossAmountUSD);
  const comm = new Decimal(opts.commissionUSD);
  const rate = new Decimal(opts.fxRate);
  // BUY net = gross + commission (total cash outflow, positive)
  // SELL net = gross − commission (proceeds after commission, positive)
  const net = opts.type === "BUY" ? gross.add(comm) : gross.sub(comm);

  return {
    id: opts.id,
    broker: "ibkr",
    date: opts.date,
    type: opts.type,
    symbol: opts.symbol,
    quantity: qty,
    pricePerShare: price,
    currency: "USD",
    grossAmount: gross,
    commission: comm,
    netAmount: net,
    fxRate: rate,
    fxDate: opts.fxDate,
    grossAmountPLN: gross.mul(rate),
    commissionPLN: comm.mul(rate),
    netAmountPLN: net.mul(rate),
  };
}

describe("Real-world Scenario: IBKR NVDA USD trades with FX conversion", () => {
  const txs: Transaction[] = [
    // Lot 1: 10 shares @ $136.82 — NBP T-1 = 2022-09-01 → 4.6959
    makeUsdTx({
      id: "nvda-buy-1",
      date: "2022-09-02",
      fxDate: "2022-09-01",
      fxRate: 4.6959,
      type: "BUY",
      symbol: "NVDA",
      quantity: 10,
      pricePerShare: 136.82,
      grossAmountUSD: 1368.20,
      commissionUSD: 0.35,
    }),
    // Lot 2: 7 shares @ $438.61 — NBP T-1 = 2023-08-01 → 4.0262
    makeUsdTx({
      id: "nvda-buy-2",
      date: "2023-08-02",
      fxDate: "2023-08-01",
      fxRate: 4.0262,
      type: "BUY",
      symbol: "NVDA",
      quantity: 7,
      pricePerShare: 438.61,
      grossAmountUSD: 3070.27,
      commissionUSD: 0.35,
    }),
    // Sell 5 shares @ $1,814.00 — NBP T-1 = 2025-11-25 → 3.6675
    makeUsdTx({
      id: "nvda-sell-1",
      date: "2025-11-26",
      fxDate: "2025-11-25",
      fxRate: 3.6675,
      type: "SELL",
      symbol: "NVDA",
      quantity: 5,
      pricePerShare: 1814.00,
      grossAmountUSD: 9070.00,
      commissionUSD: 0.52,
    }),
  ];

  it("produces one FIFO match", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
  });

  it("match is against Lot 1 only (5 of 10 shares consumed)", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expect(m.lots).toHaveLength(1);
    expectPLN(m.lots[0]!.quantityConsumed, 5, "qty consumed");
    // costPerSharePLN = netAmountPLN / 10 = (1368.55 × 4.6959) / 10 = 642.6574
    expectPLN(m.lots[0]!.costPerSharePLN, 642.66, "cost/share PLN");
    // cost basis = 5 × 642.6574 = 3213.2869 → 3213.29
    expectPLN(m.lots[0]!.costPLN, 3213.29, "lot cost PLN");
  });

  it("revenue, commission, cost basis and gain are correct in PLN", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    // revenue = 9070.00 × 3.6675 = 33,264.225 → 33264.23
    expectPLN(m.revenueGrossPLN, 33264.23, "revenue PLN");
    // sell commission = 0.52 × 3.6675 = 1.9071 → 1.91
    expectPLN(m.commissionSellPLN, 1.91, "commission PLN");
    // cost basis = 3213.29 (see above)
    expectPLN(m.costBasisPLN, 3213.29, "cost basis PLN");
    // gain = 33264.23 − 1.91 − 3213.29 = 30049.03
    expectPLN(m.gainLossPLN, 30049.03, "gain PLN");
  });

  it("Lot 1 has 5 shares remaining; Lot 2 is fully intact", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(2);
    const lot1 = remainingLots.find((l) => l.sourceTxId === "nvda-buy-1")!;
    const lot2 = remainingLots.find((l) => l.sourceTxId === "nvda-buy-2")!;
    expectPLN(lot1.remainingQuantity, 5, "lot1 remaining qty");
    expectPLN(lot1.costPerSharePLN, 642.66, "lot1 cost/share");
    expectPLN(lot2.remainingQuantity, 7, "lot2 remaining qty");
    // lot2 cost/share = (3070.62 × 4.0262) / 7 = 12362.930 / 7 = 1766.13
    expectPLN(lot2.costPerSharePLN, 1766.13, "lot2 cost/share");
  });
});

// ---------------------------------------------------------------------------
// Stock Split Scenarios
// ---------------------------------------------------------------------------

/**
 * Builds a STOCK_SPLIT pseudo-transaction.
 * `ratio` = new shares per old share (e.g. 10 for a 10:1 split, 0.1 for a reverse 1:10).
 */
function makeStockSplitTx(opts: {
  id: string;
  date: string;
  symbol: string;
  ratio: number;
}): Transaction {
  const ZERO = new Decimal(0);
  return {
    id: opts.id,
    broker: "test",
    date: opts.date,
    type: "STOCK_SPLIT",
    symbol: opts.symbol,
    quantity: new Decimal(opts.ratio),
    currency: "PLN",
    grossAmount: ZERO,
    commission: ZERO,
    netAmount: ZERO,
    fxRate: new Decimal(1),
    fxDate: opts.date,
    grossAmountPLN: ZERO,
    commissionPLN: ZERO,
    netAmountPLN: ZERO,
  };
}

// ---------------------------------------------------------------------------
// Split Scenario A — 10:1 split, sell entire post-split position
//
// Buy:   5 shares @ 1,000 PLN  (2024-01-15)  → lot cost = 5,000 PLN
// Split: 10:1                  (2024-06-10)  → 50 shares @ 100 PLN/share
// Sell: 50 shares @ 120 PLN   (2024-09-01)
//
// Revenue:  6,000 PLN
// Cost:     5,000 PLN  (basis preserved across split)
// Gain:     1,000 PLN
// ---------------------------------------------------------------------------
describe("Split Scenario A: 10:1 split, sell entire post-split position", () => {
  const txs: Transaction[] = [
    makePlnTx({ id: "b1", date: "2024-01-15", type: "BUY", symbol: "NVDA", quantity: 5, price: 1000 }),
    makeStockSplitTx({ id: "sp1", date: "2024-06-10", symbol: "NVDA", ratio: 10 }),
    makePlnTx({ id: "s1", date: "2024-09-01", type: "SELL", symbol: "NVDA", quantity: 50, price: 120 }),
  ];

  it("produces one match", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
  });

  it("cost basis is preserved across the split", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 6_000, "revenue");
    expectPLN(m.costBasisPLN, 5_000, "cost basis");
    expectPLN(m.gainLossPLN, 1_000, "gain");
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Split Scenario B — 10:1 split across two lots, only lot 1 sold
//
// Buy:   5 shares @ 1,000 PLN  (lot 1, 2024-01-15)  → basis 5,000 PLN
// Buy:   7 shares @   800 PLN  (lot 2, 2024-03-01)  → basis 5,600 PLN
// Split: 10:1                  (2024-06-10)
//   → lot 1: 50 shares @ 100 PLN/share
//   → lot 2: 70 shares @  80 PLN/share
// Sell: 50 shares @ 120 PLN    (2024-09-01)  ← consumes lot 1 entirely
//
// Lot 2 remains intact with basis preserved: 70 × 80 = 5,600 PLN.
// ---------------------------------------------------------------------------
describe("Split Scenario B: split across two lots, only lot 1 sold", () => {
  const txs: Transaction[] = [
    makePlnTx({ id: "b1", date: "2024-01-15", type: "BUY", symbol: "NVDA", quantity: 5, price: 1000 }),
    makePlnTx({ id: "b2", date: "2024-03-01", type: "BUY", symbol: "NVDA", quantity: 7, price: 800 }),
    makeStockSplitTx({ id: "sp1", date: "2024-06-10", symbol: "NVDA", ratio: 10 }),
    makePlnTx({ id: "s1", date: "2024-09-01", type: "SELL", symbol: "NVDA", quantity: 50, price: 120 }),
  ];

  it("lot 1 fully consumed, revenue and cost correct", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expectPLN(matches[0]!.revenueGrossPLN, 6_000, "revenue");
    expectPLN(matches[0]!.costBasisPLN, 5_000, "cost basis lot 1");
    expectPLN(matches[0]!.gainLossPLN, 1_000, "gain");
  });

  it("lot 2 remains with post-split qty and preserved basis", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    const lot2 = remainingLots[0]!;
    expectPLN(lot2.remainingQuantity, 70, "lot2 qty after split");
    expectPLN(lot2.costPerSharePLN, 80, "lot2 cost/share after split");
    // Total basis: 70 × 80 = 5,600 PLN (unchanged from 7 × 800)
    expectPLN(lot2.remainingQuantity.mul(lot2.costPerSharePLN), 5_600, "lot2 total basis");
  });
});

// ---------------------------------------------------------------------------
// Split Scenario C — Partially consumed lot, then split, then full sell
//
// Buy:  10 shares @ 500 PLN  (2024-01-01)  → basis 5,000 PLN
// Sell:  3 shares @ 600 PLN  (2024-03-01)  → 7 shares remaining, basis 3,500 PLN
// Split: 4:1                 (2024-06-01)  → 28 shares @ 125 PLN/share
// Sell: 28 shares @ 150 PLN  (2024-09-01)
//
// Sell 1: revenue 1,800 / cost 1,500 / gain   300
// Sell 2: revenue 4,200 / cost 3,500 / gain   700
// Invariant: 7 × 500 = 28 × 125 = 3,500 PLN preserved
// ---------------------------------------------------------------------------
describe("Split Scenario C: partially consumed lot split then sold", () => {
  const txs: Transaction[] = [
    makePlnTx({ id: "b1", date: "2024-01-01", type: "BUY", symbol: "XYZ", quantity: 10, price: 500 }),
    makePlnTx({ id: "s1", date: "2024-03-01", type: "SELL", symbol: "XYZ", quantity: 3, price: 600 }),
    makeStockSplitTx({ id: "sp1", date: "2024-06-01", symbol: "XYZ", ratio: 4 }),
    makePlnTx({ id: "s2", date: "2024-09-01", type: "SELL", symbol: "XYZ", quantity: 28, price: 150 }),
  ];

  it("produces two matches", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(2);
  });

  it("sell 1 (pre-split): revenue 1800, cost 1500, gain 300", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 1_800, "revenue sell1");
    expectPLN(m.costBasisPLN, 1_500, "cost sell1");
    expectPLN(m.gainLossPLN, 300, "gain sell1");
  });

  it("sell 2 (post-split): 28 shares, cost basis 3500 preserved, gain 700", () => {
    const { matches } = processFifo(txs);
    const m = matches[1]!;
    expectPLN(m.quantitySold, 28, "qty sold");
    expectPLN(m.revenueGrossPLN, 4_200, "revenue sell2");
    expectPLN(m.costBasisPLN, 3_500, "cost sell2 — 7×500=28×125");
    expectPLN(m.gainLossPLN, 700, "gain sell2");
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Split Scenario D — Split on fully closed position is a no-op
// ---------------------------------------------------------------------------
describe("Split Scenario D: split after position fully closed is a no-op", () => {
  const txs: Transaction[] = [
    makePlnTx({ id: "b1", date: "2024-01-01", type: "BUY", symbol: "AAPL", quantity: 10, price: 100 }),
    makePlnTx({ id: "s1", date: "2024-03-01", type: "SELL", symbol: "AAPL", quantity: 10, price: 150 }),
    makeStockSplitTx({ id: "sp1", date: "2024-06-10", symbol: "AAPL", ratio: 10 }),
  ];

  it("does not throw", () => {
    expect(() => processFifo(txs)).not.toThrow();
  });

  it("produces one match and leaves no remaining lots", () => {
    const { matches, remainingLots } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Split Scenario E — Invalid split ratio throws
// ---------------------------------------------------------------------------
describe("Split Scenario E: invalid split ratio throws", () => {
  it("throws on ratio = 0", () => {
    const txs: Transaction[] = [
      makePlnTx({ id: "b1", date: "2024-01-01", type: "BUY", symbol: "ERR", quantity: 10, price: 100 }),
      makeStockSplitTx({ id: "sp1", date: "2024-06-01", symbol: "ERR", ratio: 0 }),
    ];
    expect(() => processFifo(txs)).toThrow(/invalid ratio/i);
  });

  it("throws on negative ratio", () => {
    const txs: Transaction[] = [
      makePlnTx({ id: "b1", date: "2024-01-01", type: "BUY", symbol: "ERR", quantity: 10, price: 100 }),
      makeStockSplitTx({ id: "sp1", date: "2024-06-01", symbol: "ERR", ratio: -5 }),
    ];
    expect(() => processFifo(txs)).toThrow(/invalid ratio/i);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("throws when selling more shares than available", () => {
    const txs: Transaction[] = [
      makePlnTx({
        id: "b1",
        date: "2024-01-01",
        type: "BUY",
        symbol: "ERR",
        quantity: 10,
        price: 100,
      }),
      makePlnTx({
        id: "s1",
        date: "2024-06-01",
        type: "SELL",
        symbol: "ERR",
        quantity: 20,
        price: 120,
      }),
    ];
    expect(() => processFifo(txs)).toThrow(/insufficient shares/i);
  });

  it("ignores non-BUY/SELL transaction types", () => {
    const ONE = new Decimal(1);
    const gross = new Decimal(100);
    const div: Transaction = {
      id: "d1",
      broker: "test",
      date: "2024-05-01",
      type: "DIVIDEND",
      symbol: "DIV",
      currency: "PLN",
      grossAmount: gross,
      commission: new Decimal(0),
      netAmount: gross,
      fxRate: ONE,
      fxDate: "2024-05-01",
      grossAmountPLN: gross,
      commissionPLN: new Decimal(0),
      netAmountPLN: gross,
    };
    const { matches, remainingLots } = processFifo([div]);
    expect(matches).toHaveLength(0);
    expect(remainingLots).toHaveLength(0);
  });

  it("handles multiple symbols independently", () => {
    const txs: Transaction[] = [
      makePlnTx({
        id: "a-b1",
        date: "2024-01-01",
        type: "BUY",
        symbol: "AAA",
        quantity: 10,
        price: 100,
      }),
      makePlnTx({
        id: "b-b1",
        date: "2024-01-01",
        type: "BUY",
        symbol: "BBB",
        quantity: 20,
        price: 50,
      }),
      makePlnTx({
        id: "a-s1",
        date: "2024-12-01",
        type: "SELL",
        symbol: "AAA",
        quantity: 10,
        price: 150,
      }),
      makePlnTx({
        id: "b-s1",
        date: "2024-12-01",
        type: "SELL",
        symbol: "BBB",
        quantity: 20,
        price: 75,
      }),
    ];
    const { matches, remainingLots } = processFifo(txs);
    expect(matches).toHaveLength(2);
    expect(remainingLots).toHaveLength(0);
    const aaMatch = matches.find((m) => m.symbol === "AAA")!;
    const bbMatch = matches.find((m) => m.symbol === "BBB")!;
    expectPLN(aaMatch.gainLossPLN, 500, "AAA gain");
    expectPLN(bbMatch.gainLossPLN, 500, "BBB gain");
  });
});
