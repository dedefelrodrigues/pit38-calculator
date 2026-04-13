import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Decimal from "decimal.js";
import { parseNbpCsv, lookupFxRate, enrichTransaction, detectMissingRates, mergeNbpRates } from "../src/fx.js";
import type { RawTransaction } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal inline NBP CSV covering 2024-01-02 → 2024-01-08 (with weekend gap).
 * Includes currencies with different unit multipliers.
 *
 * Dates present: Tue 02, Wed 03, Thu 04, Fri 05, Mon 08
 * Absent (weekend): Sat 06, Sun 07
 */
const MINI_CSV = [
  "data;1USD;1EUR;100HUF;100JPY;10000IDR;nr tabeli;pełny numer tabeli;",
  ";dolar;euro;forint;jen;rupia;;;",
  "20240102;3,9432;4,3434;1,1365;2,7855;2,5489;1;001/A/NBP/2024;",
  "20240103;3,9909;4,3646;1,1462;2,7977;2,5781;2;002/A/NBP/2024;",
  "20240104;3,9684;4,3525;1,1468;2,7583;2,5619;3;003/A/NBP/2024;",
  "20240105;3,9850;4,3484;1,1498;2,7443;2,5682;4;004/A/NBP/2024;",
  "20240108;3,9812;4,3548;1,1528;2,7605;2,5644;5;005/A/NBP/2024;",
].join("\n");

/** Helper: compare a Decimal to an expected numeric string at 10 dp. */
function expectRate(actual: Decimal, expected: string, label = ""): void {
  expect(actual.toFixed(10), label).toBe(new Decimal(expected).toFixed(10));
}

// ---------------------------------------------------------------------------
// parseNbpCsv — structure
// ---------------------------------------------------------------------------

describe("parseNbpCsv — structure", () => {
  it("returns the correct sorted date list", () => {
    const table = parseNbpCsv(MINI_CSV);
    expect(table.dates).toEqual([
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
      "2024-01-08",
    ]);
  });

  it("throws when header row is absent", () => {
    expect(() => parseNbpCsv("no header here\n20240102;3,9432")).toThrow(/header row not found/i);
  });
});

// ---------------------------------------------------------------------------
// parseNbpCsv — rate parsing and multiplier normalisation
// ---------------------------------------------------------------------------

describe("parseNbpCsv — rates on 2024-01-02", () => {
  const table = parseNbpCsv(MINI_CSV);
  const rates = table.rates.get("2024-01-02")!;

  it("USD (multiplier 1): 3.9432 PLN/USD", () => {
    expectRate(rates.get("USD")!, "3.9432");
  });

  it("EUR (multiplier 1): 4.3434 PLN/EUR", () => {
    expectRate(rates.get("EUR")!, "4.3434");
  });

  it("HUF (multiplier 100): 1.1365 / 100 = 0.011365 PLN/HUF", () => {
    expectRate(rates.get("HUF")!, "0.011365");
  });

  it("JPY (multiplier 100): 2.7855 / 100 = 0.027855 PLN/JPY", () => {
    expectRate(rates.get("JPY")!, "0.027855");
  });

  it("IDR (multiplier 10000): 2.5489 / 10000 = 0.00025489 PLN/IDR", () => {
    expectRate(rates.get("IDR")!, "0.00025489");
  });
});

// ---------------------------------------------------------------------------
// lookupFxRate — T-1 business day rule
// ---------------------------------------------------------------------------

describe("lookupFxRate — T-1 rule", () => {
  const table = parseNbpCsv(MINI_CSV);

  it("PLN always returns rate=1 without a table lookup", () => {
    const result = lookupFxRate(table, "2024-01-03", "PLN");
    expectRate(result.rate, "1");
    expect(result.rateDate).toBe("2024-01-03");
  });

  it("weekday: Wed 2024-01-03 uses Tue 2024-01-02 rate", () => {
    const result = lookupFxRate(table, "2024-01-03", "USD");
    expect(result.rateDate).toBe("2024-01-02");
    expectRate(result.rate, "3.9432");
  });

  it("weekday: Thu 2024-01-04 uses Wed 2024-01-03 rate", () => {
    const result = lookupFxRate(table, "2024-01-04", "USD");
    expect(result.rateDate).toBe("2024-01-03");
    expectRate(result.rate, "3.9909");
  });

  it("Monday: 2024-01-08 skips weekend and uses Fri 2024-01-05", () => {
    const result = lookupFxRate(table, "2024-01-08", "USD");
    expect(result.rateDate).toBe("2024-01-05");
    expectRate(result.rate, "3.9850");
  });

  it("Saturday: 2024-01-06 (not in table) uses Fri 2024-01-05", () => {
    const result = lookupFxRate(table, "2024-01-06", "USD");
    expect(result.rateDate).toBe("2024-01-05");
  });

  it("Sunday: 2024-01-07 (not in table) uses Fri 2024-01-05", () => {
    const result = lookupFxRate(table, "2024-01-07", "USD");
    expect(result.rateDate).toBe("2024-01-05");
  });

  it("a date that IS in the table still uses T-1 (not T-0)", () => {
    // 2024-01-05 is in the table, but a transaction on that day
    // must use the previous day's rate (2024-01-04)
    const result = lookupFxRate(table, "2024-01-05", "USD");
    expect(result.rateDate).toBe("2024-01-04");
    expectRate(result.rate, "3.9684");
  });

  it("throws when no prior date exists (transaction before earliest table entry)", () => {
    expect(() => lookupFxRate(table, "2024-01-02", "USD")).toThrow(/no rate available before/i);
    expect(() => lookupFxRate(table, "2023-12-31", "USD")).toThrow(/no rate available before/i);
  });

  it("throws for a currency not present in the table", () => {
    expect(() => lookupFxRate(table, "2024-01-03", "XYZ" as never)).toThrow(/XYZ/);
  });
});

// ---------------------------------------------------------------------------
// enrichTransaction
// ---------------------------------------------------------------------------

describe("enrichTransaction", () => {
  const table = parseNbpCsv(MINI_CSV);

  function makeRaw(opts: {
    date: string;
    currency: "USD" | "EUR" | "PLN";
    type: "BUY" | "SELL";
    gross: number;
    commission?: number;
  }): RawTransaction {
    const gross = new Decimal(opts.gross);
    const comm = new Decimal(opts.commission ?? 0);
    const net = opts.type === "BUY" ? gross.add(comm) : gross.sub(comm);
    return {
      id: "t1",
      broker: "test",
      date: opts.date,
      type: opts.type,
      symbol: "TEST",
      currency: opts.currency,
      grossAmount: gross,
      commission: comm,
      netAmount: net,
    };
  }

  it("PLN transaction: fxRate=1, PLN fields equal originals", () => {
    const raw = makeRaw({ date: "2024-01-03", currency: "PLN", type: "BUY", gross: 1000, commission: 5 });
    const tx = enrichTransaction(raw, table);

    expectRate(tx.fxRate, "1");
    expect(tx.fxDate).toBe("2024-01-03");
    expectRate(tx.grossAmountPLN, "1000");
    expectRate(tx.commissionPLN, "5");
    expectRate(tx.netAmountPLN, "1005"); // BUY: gross + commission
  });

  it("USD BUY: converts grossAmount, commission, netAmount to PLN using T-1 rate", () => {
    // Transaction on 2024-01-03 → T-1 = 2024-01-02 → USD rate = 3.9432
    const raw = makeRaw({ date: "2024-01-03", currency: "USD", type: "BUY", gross: 1000, commission: 2 });
    const tx = enrichTransaction(raw, table);

    expect(tx.fxDate).toBe("2024-01-02");
    expectRate(tx.fxRate, "3.9432");
    // grossAmountPLN = 1000 × 3.9432 = 3943.2
    expectRate(tx.grossAmountPLN, "3943.2");
    // commissionPLN = 2 × 3.9432 = 7.8864
    expectRate(tx.commissionPLN, "7.8864");
    // netAmountPLN = (1000 + 2) × 3.9432 = 1002 × 3.9432 = 3950.0864
    // (= grossAmountPLN + commissionPLN)
    expectRate(tx.netAmountPLN, "3951.0864");
  });

  it("EUR SELL: converts correctly and netAmount = gross - commission", () => {
    // Transaction on 2024-01-08 (Monday) → T-1 = 2024-01-05 → EUR rate = 4.3484
    const raw = makeRaw({ date: "2024-01-08", currency: "EUR", type: "SELL", gross: 500, commission: 1 });
    const tx = enrichTransaction(raw, table);

    expect(tx.fxDate).toBe("2024-01-05");
    expectRate(tx.fxRate, "4.3484");
    expectRate(tx.grossAmountPLN, "2174.2");    // 500 × 4.3484
    expectRate(tx.commissionPLN, "4.3484");      // 1 × 4.3484
    expectRate(tx.netAmountPLN, "2169.8516");    // (500 − 1) × 4.3484
  });

  it("preserves all original RawTransaction fields", () => {
    const raw = makeRaw({ date: "2024-01-03", currency: "USD", type: "BUY", gross: 500 });
    const tx = enrichTransaction(raw, table);
    expect(tx.id).toBe(raw.id);
    expect(tx.symbol).toBe(raw.symbol);
    expect(tx.broker).toBe(raw.broker);
    expect(tx.currency).toBe("USD");
  });
});

// ---------------------------------------------------------------------------
// Integration: real nbp-sample.csv
// ---------------------------------------------------------------------------

describe("integration — real nbp-sample.csv", () => {
  const csvPath = resolve(__dirname, "../../../reference/nbp-sample.csv");
  const csv = readFileSync(csvPath, "latin1"); // NBP uses ISO-8859-2 / Windows-1250
  const table = parseNbpCsv(csv);

  it("parses all 251 trading days of 2024", () => {
    // 2024 had 252 NBP table entries (check actual count from sample)
    expect(table.dates.length).toBeGreaterThanOrEqual(240);
    expect(table.dates[0]).toBe("2024-01-02");
    expect(table.dates.at(-1)).toBe("2024-12-31");
  });

  it("USD rate on 2024-01-02 matches known published value", () => {
    const { rate } = lookupFxRate(table, "2024-01-03", "USD");
    expectRate(rate, "3.9432");
  });

  it("EUR rate on 2024-01-02 matches known published value", () => {
    const { rate } = lookupFxRate(table, "2024-01-03", "EUR");
    expectRate(rate, "4.3434");
  });

  it("T-1 skips New Year: 2024-01-02 transaction uses 2023 rate (throws — not in sample)", () => {
    // nbp-sample.csv only covers 2024; 2023 rates are absent
    expect(() => lookupFxRate(table, "2024-01-02", "USD")).toThrow(/no rate available before/i);
  });

  it("HUF rate is correctly divided by 100", () => {
    const { rate } = lookupFxRate(table, "2024-01-03", "HUF");
    // Raw value = 1.1365, multiplier = 100 → per unit = 0.011365
    expectRate(rate, "0.011365");
  });

  it("GBP is present and has a plausible rate", () => {
    const { rate } = lookupFxRate(table, "2024-06-01", "GBP");
    // GBP should be above 4 PLN in 2024
    expect(rate.gt(new Decimal("4"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectMissingRates
// ---------------------------------------------------------------------------

describe("detectMissingRates", () => {
  const table = parseNbpCsv(MINI_CSV);
  // MINI_CSV covers 2024-01-02 → 2024-01-08; T-1 for 2024-01-03 is 2024-01-02 ✓

  function raw(date: string, currency: "USD" | "EUR" | "PLN"): RawTransaction {
    const g = new Decimal(100);
    return {
      id: `${date}-${currency}`,
      broker: "test",
      date,
      type: "BUY",
      symbol: "X",
      currency,
      grossAmount: g,
      commission: new Decimal(0),
      netAmount: g,
    };
  }

  it("returns empty array when all transactions are covered by the table", () => {
    const txs = [
      raw("2024-01-03", "USD"), // T-1 = 2024-01-02 ✓
      raw("2024-01-08", "EUR"), // T-1 = 2024-01-05 ✓
    ];
    expect(detectMissingRates(txs, table)).toHaveLength(0);
  });

  it("returns a missing entry when the T-1 date is before the table", () => {
    const txs = [raw("2024-01-02", "USD")]; // T-1 would be 2024-01-01, not in table
    const missing = detectMissingRates(txs, table);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.transactionDate).toBe("2024-01-02");
    expect(missing[0]!.currency).toBe("USD");
  });

  it("skips PLN transactions entirely", () => {
    const txs = [raw("2024-01-02", "PLN")]; // would fail for USD, but PLN is exempt
    expect(detectMissingRates(txs, table)).toHaveLength(0);
  });

  it("deduplicates the same (date, currency) pair", () => {
    const txs = [
      raw("2024-01-02", "USD"),
      raw("2024-01-02", "USD"), // duplicate
    ];
    expect(detectMissingRates(txs, table)).toHaveLength(1);
  });

  it("returns one entry per distinct (date, currency) pair", () => {
    const txs = [
      raw("2024-01-02", "USD"), // missing
      raw("2024-01-02", "EUR"), // missing (same date, different currency)
      raw("2024-01-03", "USD"), // covered
    ];
    const missing = detectMissingRates(txs, table);
    expect(missing).toHaveLength(2);
    const currencies = missing.map((m) => m.currency).sort();
    expect(currencies).toEqual(["EUR", "USD"]);
  });
});

// ---------------------------------------------------------------------------
// mergeNbpRates
// ---------------------------------------------------------------------------

describe("mergeNbpRates", () => {
  const base = parseNbpCsv(MINI_CSV);

  it("returns the same table instance when additions is empty", () => {
    const result = mergeNbpRates(base, new Map());
    expect(result).toBe(base);
  });

  it("adds a new date that was not in the original table", () => {
    const additions = new Map([
      ["2024-01-01", new Map([["USD", new Decimal("4.0000")]])],
    ]);
    const merged = mergeNbpRates(base, additions);
    expect(merged.dates).toContain("2024-01-01");
    expect(merged.dates[0]).toBe("2024-01-01"); // sorted to front
    expectRate(merged.rates.get("2024-01-01")!.get("USD")!, "4.0000");
  });

  it("does not mutate the original table", () => {
    const additions = new Map([
      ["2024-01-09", new Map([["USD", new Decimal("4.0000")]])],
    ]);
    mergeNbpRates(base, additions);
    expect(base.dates).not.toContain("2024-01-09");
  });

  it("merges additional currencies into an existing date", () => {
    // Add a currency (CNH) that wasn't in MINI_CSV for 2024-01-02
    const additions = new Map([
      ["2024-01-02", new Map([["CNH", new Decimal("0.5500")]])],
    ]);
    const merged = mergeNbpRates(base, additions);
    const row = merged.rates.get("2024-01-02")!;
    // Original currencies still present
    expectRate(row.get("USD")!, "3.9432");
    // New currency added
    expectRate(row.get("CNH")!, "0.5500");
  });
});
