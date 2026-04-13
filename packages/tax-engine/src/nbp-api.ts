import Decimal from "decimal.js";
import { mergeNbpRates } from "./fx.js";
import type { MissingRate, NbpTable } from "./fx.js";

// ---------------------------------------------------------------------------
// NBP REST API — Table A
// Docs: https://api.nbp.pl/
// ---------------------------------------------------------------------------

const NBP_API_BASE = "https://api.nbp.pl/api/exchangerates/tables/A";

/**
 * Maximum number of calendar days to walk backwards when searching for the
 * nearest published NBP table. 14 days covers the longest possible gap
 * (e.g. Christmas–New Year bridge week plus a weekend on either side).
 */
const MAX_LOOKBACK = 14;

// ---------------------------------------------------------------------------
// Internal types for the NBP API JSON response
// ---------------------------------------------------------------------------

interface NbpApiRate {
  currency: string; // Polish name, e.g. "dolar amerykański"
  code: string; // ISO code, e.g. "USD"
  mid: number; // PLN per 1 unit of the currency (no multiplier needed)
}

interface NbpApiTableEntry {
  table: string; // "A"
  no: string; // e.g. "001/A/NBP/2025"
  effectiveDate: string; // "YYYY-MM-DD"
  rates: NbpApiRate[];
}

// ---------------------------------------------------------------------------
// fetchNbpRatesForDate
// ---------------------------------------------------------------------------

/**
 * Fetches NBP Table A rates for a single `date` from the public NBP REST API.
 *
 * Returns a `Map<currencyCode, PLN-per-1-unit>` on success, or `null` when
 * the NBP did not publish a table on that date (404 — weekend or holiday).
 *
 * Throws for any other HTTP error or network failure.
 *
 * Note: the API always returns rates per 1 unit of each currency; no
 * multiplier adjustment is needed (unlike the CSV where 100HUF, 100JPY, etc.
 * require dividing by the column header prefix).
 */
export async function fetchNbpRatesForDate(
  date: string,
): Promise<Map<string, Decimal> | null> {
  const url = `${NBP_API_BASE}/${date}/?format=json`;
  const res = await fetch(url);

  if (res.status === 404) return null; // not a business day — no table published

  if (!res.ok) {
    throw new Error(`NBP API: unexpected HTTP ${res.status} for date ${date} (${url})`);
  }

  const json = (await res.json()) as NbpApiTableEntry[];
  const rates = new Map<string, Decimal>();

  for (const entry of json) {
    for (const r of entry.rates) {
      rates.set(r.code, new Decimal(r.mid));
    }
  }

  return rates;
}

// ---------------------------------------------------------------------------
// resolveAndFetchMissing
// ---------------------------------------------------------------------------

/**
 * For each entry in `missing`, walks backwards from the transaction date
 * (starting at T-1 = transactionDate − 1 day) until it finds a published
 * NBP table — first checking `table` itself, then fetching from the API.
 *
 * Returns a new `NbpTable` that includes all the original rates plus any
 * newly fetched ones. The original `table` is never mutated.
 *
 * Deduplication:
 * - Multiple transactions on the same date share one API traversal.
 * - API responses are cached within the call to avoid duplicate network requests.
 *
 * Throws if no published table is found within MAX_LOOKBACK (14) days.
 */
export async function resolveAndFetchMissing(
  table: NbpTable,
  missing: MissingRate[],
): Promise<NbpTable> {
  if (missing.length === 0) return table;

  // Unique transaction dates that need resolution
  const uniqueDates = [...new Set(missing.map((m) => m.transactionDate))];

  // Accumulates newly fetched rates to merge into the table at the end
  const additions = new Map<string, Map<string, Decimal>>();

  // Cache of API responses for this call to avoid redundant fetches
  const apiCache = new Map<string, Map<string, Decimal> | null>();

  for (const txDate of uniqueDates) {
    let candidate = subtractOneDay(txDate);
    let resolved = false;

    for (let attempt = 0; attempt < MAX_LOOKBACK; attempt++) {
      // Already present in the original table?
      if (table.rates.has(candidate)) {
        resolved = true;
        break;
      }

      // Already fetched during this call?
      if (additions.has(candidate)) {
        resolved = true;
        break;
      }

      // Fetch from API (with cache to avoid duplicate requests)
      if (!apiCache.has(candidate)) {
        apiCache.set(candidate, await fetchNbpRatesForDate(candidate));
      }

      const fetched = apiCache.get(candidate)!;
      if (fetched !== null) {
        additions.set(candidate, fetched);
        resolved = true;
        break;
      }

      // 404 (non-business day) — try the previous day
      candidate = subtractOneDay(candidate);
    }

    if (!resolved) {
      throw new Error(
        `NBP API: could not find a published table within ${MAX_LOOKBACK} days ` +
          `before ${txDate} — check your internet connection or the NBP API status`,
      );
    }
  }

  return mergeNbpRates(table, additions);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the ISO date string for the calendar day before `isoDate`.
 * Uses noon UTC to avoid DST edge cases.
 */
function subtractOneDay(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
