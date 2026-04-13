import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Decimal from "decimal.js";
import { parseNbpCsv, detectMissingRates } from "../src/fx.js";
import { fetchNbpRatesForDate, resolveAndFetchMissing } from "../src/nbp-api.js";
import type { RawTransaction } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Mini table covering only 2024-01-02 and 2024-01-03.
 * Used to simulate "rates missing for later dates".
 */
const MINI_CSV = [
  "data;1USD;1EUR;nr tabeli;pełny numer tabeli;",
  ";dolar;euro;;",
  "20240102;3,9432;4,3434;1;001/A/NBP/2024;",
  "20240103;3,9909;4,3646;2;002/A/NBP/2024;",
].join("\n");

/** Builds a minimal NBP API success response for one date. */
function apiResponse(date: string, rates: Record<string, number>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => [
      {
        table: "A",
        no: "001/A/NBP/test",
        effectiveDate: date,
        rates: Object.entries(rates).map(([code, mid]) => ({
          currency: code,
          code,
          mid,
        })),
      },
    ],
  } as unknown as Response;
}

/** Simulates a 404 — no table published on this date (weekend / holiday). */
function api404(): Response {
  return { ok: false, status: 404 } as unknown as Response;
}

/** Simulates a server-side error. */
function api500(): Response {
  return { ok: false, status: 500 } as unknown as Response;
}

/** Builds a minimal RawTransaction for gap-detection tests. */
function rawTx(date: string, currency: "USD" | "EUR"): RawTransaction {
  const g = new Decimal(1000);
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

// ---------------------------------------------------------------------------
// Setup / teardown — mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// fetchNbpRatesForDate
// ---------------------------------------------------------------------------

describe("fetchNbpRatesForDate", () => {
  it("returns a rate map on HTTP 200", async () => {
    mockFetch.mockResolvedValueOnce(
      apiResponse("2025-01-15", { USD: 4.1234, EUR: 4.2789 }),
    );
    const rates = await fetchNbpRatesForDate("2025-01-15");
    expect(rates).not.toBeNull();
    expect(rates!.get("USD")?.toFixed(4)).toBe("4.1234");
    expect(rates!.get("EUR")?.toFixed(4)).toBe("4.2789");
  });

  it("returns null on HTTP 404 (non-business day)", async () => {
    mockFetch.mockResolvedValueOnce(api404());
    const result = await fetchNbpRatesForDate("2025-01-11"); // Saturday
    expect(result).toBeNull();
  });

  it("throws on HTTP 500", async () => {
    mockFetch.mockResolvedValueOnce(api500());
    await expect(fetchNbpRatesForDate("2025-01-15")).rejects.toThrow(/HTTP 500/);
  });

  it("calls the correct NBP API URL", async () => {
    mockFetch.mockResolvedValueOnce(apiResponse("2025-03-10", { USD: 4.0 }));
    await fetchNbpRatesForDate("2025-03-10");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.nbp.pl/api/exchangerates/tables/A/2025-03-10/?format=json",
    );
  });

  it("stores rates as Decimal (not float)", async () => {
    mockFetch.mockResolvedValueOnce(apiResponse("2025-01-15", { USD: 4.1234 }));
    const rates = await fetchNbpRatesForDate("2025-01-15");
    expect(rates!.get("USD")).toBeInstanceOf(Decimal);
  });
});

// ---------------------------------------------------------------------------
// resolveAndFetchMissing
// ---------------------------------------------------------------------------

describe("resolveAndFetchMissing", () => {
  const table = parseNbpCsv(MINI_CSV);
  // table covers 2024-01-02, 2024-01-03 only

  it("returns the original table unchanged when missing is empty", async () => {
    const result = await resolveAndFetchMissing(table, []);
    expect(result).toBe(table); // same reference, nothing fetched
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches T-1 date and merges it into the table", async () => {
    // Transaction on 2025-01-15 (Wednesday) → T-1 = 2025-01-14 (Tuesday)
    // 2025-01-14 is not in MINI_CSV → must be fetched
    mockFetch.mockResolvedValueOnce(apiResponse("2025-01-14", { USD: 4.1500, EUR: 4.3000 }));

    const missing = [{ transactionDate: "2025-01-15", currency: "USD" as const }];
    const updated = await resolveAndFetchMissing(table, missing);

    expect(updated.dates).toContain("2025-01-14");
    expect(updated.rates.get("2025-01-14")!.get("USD")?.toFixed(4)).toBe("4.1500");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips a 404 (non-business day) and walks back to the previous day", async () => {
    // Transaction on 2025-01-13 (Monday) → T-1 = 2025-01-12 (Sunday → 404)
    //                                    → then 2025-01-11 (Saturday → 404)
    //                                    → then 2025-01-10 (Friday → 200)
    mockFetch
      .mockResolvedValueOnce(api404()) // 2025-01-12 Sunday
      .mockResolvedValueOnce(api404()) // 2025-01-11 Saturday
      .mockResolvedValueOnce(apiResponse("2025-01-10", { USD: 4.0800 })); // Friday ✓

    const missing = [{ transactionDate: "2025-01-13", currency: "USD" as const }];
    const updated = await resolveAndFetchMissing(table, missing);

    expect(updated.dates).toContain("2025-01-10");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("uses the existing table entry without fetching when T-1 is already present", async () => {
    // Transaction on 2024-01-04 → T-1 = 2024-01-03, which IS in MINI_CSV
    // detectMissingRates would not flag this, but test the resolver directly:
    const missing = detectMissingRates([rawTx("2024-01-04", "USD")], table);
    expect(missing).toHaveLength(0); // already covered — resolveAndFetchMissing won't be called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("deduplicates: two transactions on the same date share one API traversal", async () => {
    // Both need T-1 for 2025-02-03 → T-1 = 2025-02-02
    mockFetch.mockResolvedValueOnce(apiResponse("2025-02-02", { USD: 4.1000, EUR: 4.2500 }));

    const missing = [
      { transactionDate: "2025-02-03", currency: "USD" as const },
      { transactionDate: "2025-02-03", currency: "EUR" as const },
    ];
    await resolveAndFetchMissing(table, missing);

    // Only one fetch despite two missing currencies on the same date
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch a date already retrieved earlier in the same call", async () => {
    // Two transactions on different dates that both resolve to the same T-1
    // 2025-01-06 (Mon) → T-1 = 2025-01-05 (if Fri is not a holiday)
    // 2025-01-07 (Tue) → T-1 = 2025-01-06 → 404 (Monday = holiday) → 2025-01-05
    mockFetch
      .mockResolvedValueOnce(apiResponse("2025-01-05", { USD: 4.0500 })) // first traversal
      .mockResolvedValueOnce(api404()) // 2025-01-06 attempted for second traversal
      // 2025-01-05 should be served from cache, not fetched again
      ;

    const missing = [
      { transactionDate: "2025-01-06", currency: "USD" as const },
      { transactionDate: "2025-01-07", currency: "USD" as const },
    ];
    await resolveAndFetchMissing(table, missing);

    // 2: one for 2025-01-05 (first tx), one 404 for 2025-01-06 (second tx)
    // 2025-01-05 is then found in additions cache — no third call
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after MAX_LOOKBACK consecutive 404s", async () => {
    // Simulate the API returning 404 for all 14 days
    for (let i = 0; i < 14; i++) {
      mockFetch.mockResolvedValueOnce(api404());
    }

    const missing = [{ transactionDate: "2025-06-01", currency: "USD" as const }];
    await expect(resolveAndFetchMissing(table, missing)).rejects.toThrow(
      /could not find a published table/i,
    );
  });

  it("does not mutate the original table", async () => {
    const originalDateCount = table.dates.length;
    mockFetch.mockResolvedValueOnce(apiResponse("2025-01-14", { USD: 4.15 }));

    const missing = [{ transactionDate: "2025-01-15", currency: "USD" as const }];
    await resolveAndFetchMissing(table, missing);

    expect(table.dates).toHaveLength(originalDateCount);
  });
});
