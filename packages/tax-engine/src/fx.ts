import Decimal from "decimal.js";
import type { Currency, RawTransaction, Transaction } from "./types.js";

// ---------------------------------------------------------------------------
// NbpTable — parsed, immutable representation of NBP Table A CSV
// ---------------------------------------------------------------------------

export interface NbpTable {
  /** All dates present in the table, sorted ascending ("YYYY-MM-DD"). */
  readonly dates: readonly string[];
  /**
   * date → currency code → PLN per 1 unit of that currency.
   * Multipliers (100HUF, 10000IDR, …) are already factored in.
   */
  readonly rates: ReadonlyMap<string, ReadonlyMap<string, Decimal>>;
}

// ---------------------------------------------------------------------------
// parseNbpCsv
// ---------------------------------------------------------------------------

/**
 * Parses NBP Table A CSV (semicolon-delimited, comma decimal separator).
 *
 * Header format:  data;1THB;1USD;100HUF;100JPY;10000IDR;…;nr tabeli;pełny numer tabeli;
 * Date format:    YYYYMMDD  (weekends and Polish holidays are absent)
 * Rate format:    3,9432  (comma as decimal separator)
 *
 * The numeric prefix in each column header is the unit size; rates are
 * normalised to PLN per 1 unit before storing.
 */
export function parseNbpCsv(csv: string): NbpTable {
  const lines = csv.split(/\r?\n/);

  // Locate the header row — it starts with "data;"
  const headerLine = lines.find((l) => l.startsWith("data;"));
  if (!headerLine) throw new Error("NBP CSV: header row not found");

  // Build a map of column index → { currency, multiplier }
  interface ColInfo {
    currency: string;
    multiplier: Decimal;
    index: number;
  }

  const columns: ColInfo[] = [];
  const headerFields = headerLine.split(";");
  for (let i = 1; i < headerFields.length; i++) {
    const field = headerFields[i]!.trim();
    // Matches "1USD", "100HUF", "10000IDR", etc. — skips "nr tabeli" and trailing empties
    const m = /^(\d+)([A-Z]+)$/.exec(field);
    if (!m) continue;
    columns.push({ currency: m[2]!, multiplier: new Decimal(m[1]!), index: i });
  }

  if (columns.length === 0) throw new Error("NBP CSV: no currency columns found");

  // Parse each data row
  const dates: string[] = [];
  const ratesMap = new Map<string, Map<string, Decimal>>();

  for (const line of lines) {
    const fields = line.split(";");
    const raw = fields[0]?.trim() ?? "";
    if (!/^\d{8}$/.test(raw)) continue; // skip header, name row, blank lines

    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const rowRates = new Map<string, Decimal>();

    for (const col of columns) {
      const cell = fields[col.index]?.trim();
      if (!cell) continue;
      // Polish decimal comma → dot, then divide by the unit multiplier
      const ratePerUnit = new Decimal(cell.replace(",", ".")).div(col.multiplier);
      rowRates.set(col.currency, ratePerUnit);
    }

    dates.push(date);
    ratesMap.set(date, rowRates);
  }

  dates.sort(); // should already be sorted, but guarantee it

  return { dates, rates: ratesMap };
}

// ---------------------------------------------------------------------------
// lookupFxRate — T-1 business day rule
// ---------------------------------------------------------------------------

export interface FxRateLookup {
  /** PLN per 1 unit of the requested currency. */
  rate: Decimal;
  /** The NBP table date that was used (always < transactionDate). */
  rateDate: string;
}

/**
 * Returns the NBP exchange rate for `currency` using the T-1 rule:
 * the last NBP table published *strictly before* `transactionDate`.
 *
 * For PLN, returns rate = 1 and rateDate = transactionDate (no lookup needed).
 *
 * Throws if:
 * - No table entry exists before `transactionDate`
 * - The currency is not present in the table
 */
export function lookupFxRate(
  table: NbpTable,
  transactionDate: string,
  currency: Currency,
): FxRateLookup {
  if (currency === "PLN") {
    return { rate: new Decimal(1), rateDate: transactionDate };
  }

  const priorDate = findPriorDate(table.dates, transactionDate);
  if (priorDate === undefined) {
    throw new Error(
      `NBP: no rate available before ${transactionDate} — ` +
        `earliest date in table is ${table.dates[0]}`,
    );
  }

  const rowRates = table.rates.get(priorDate);
  if (!rowRates) {
    // Should not happen if the table is well-formed
    throw new Error(`NBP: internal error — date ${priorDate} missing from rates map`);
  }

  const rate = rowRates.get(currency as string);
  if (rate === undefined) {
    throw new Error(
      `NBP: currency ${currency} not found in table for ${priorDate}`,
    );
  }

  return { rate, rateDate: priorDate };
}

// ---------------------------------------------------------------------------
// enrichTransaction / enrichTransactions
// ---------------------------------------------------------------------------

/**
 * Converts a `RawTransaction` into a `Transaction` by attaching the NBP T-1
 * exchange rate and computing all three PLN-denominated amount fields.
 */
export function enrichTransaction(raw: RawTransaction, table: NbpTable): Transaction {
  const { rate: fxRate, rateDate: fxDate } = lookupFxRate(table, raw.date, raw.currency);

  return {
    ...raw,
    fxRate,
    fxDate,
    grossAmountPLN: raw.grossAmount.mul(fxRate),
    commissionPLN: raw.commission.mul(fxRate),
    netAmountPLN: raw.netAmount.mul(fxRate),
  };
}

/**
 * Enriches a list of raw transactions. Transactions that are already in PLN
 * receive fxRate = 1 without a table lookup.
 */
export function enrichTransactions(raws: RawTransaction[], table: NbpTable): Transaction[] {
  return raws.map((r) => enrichTransaction(r, table));
}

// ---------------------------------------------------------------------------
// detectMissingRates — find (date, currency) pairs not covered by the table
// ---------------------------------------------------------------------------

export interface MissingRate {
  /** ISO date of the transaction that needs conversion: "YYYY-MM-DD". */
  transactionDate: string;
  /** The foreign currency whose T-1 rate is absent from the table. */
  currency: Currency;
}

/**
 * Scans `transactions` and returns every (transactionDate, currency) pair
 * for which `lookupFxRate` would throw — i.e. the T-1 date is not present
 * in the table.
 *
 * PLN transactions are always skipped (no lookup needed).
 * Duplicate (date, currency) pairs are deduplicated.
 *
 * Use this before calling `enrichTransactions` to detect gaps, then pass
 * the result to `resolveAndFetchMissing` (in nbp-api.ts) to fill them.
 */
export function detectMissingRates(
  transactions: RawTransaction[],
  table: NbpTable,
): MissingRate[] {
  const seen = new Set<string>();
  const missing: MissingRate[] = [];

  for (const tx of transactions) {
    if (tx.currency === "PLN") continue;

    const key = `${tx.date}:${tx.currency as string}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      lookupFxRate(table, tx.date, tx.currency);
    } catch {
      missing.push({ transactionDate: tx.date, currency: tx.currency });
    }
  }

  return missing;
}

// ---------------------------------------------------------------------------
// mergeNbpRates — non-destructively combine two sets of rates
// ---------------------------------------------------------------------------

/**
 * Returns a new `NbpTable` that contains all dates from `table` plus the
 * entries in `additions`. Existing dates are preserved; for a date present
 * in both, currencies from `additions` are merged in (additions win on conflict).
 *
 * The original `table` is never mutated.
 */
export function mergeNbpRates(
  table: NbpTable,
  additions: ReadonlyMap<string, ReadonlyMap<string, Decimal>>,
): NbpTable {
  if (additions.size === 0) return table;

  const merged = new Map<string, Map<string, Decimal>>();

  for (const [date, rates] of table.rates) {
    merged.set(date, new Map(rates));
  }

  for (const [date, rates] of additions) {
    if (!merged.has(date)) {
      merged.set(date, new Map(rates));
    } else {
      const row = merged.get(date)!;
      for (const [currency, rate] of rates) {
        row.set(currency, rate);
      }
    }
  }

  const dates = [...merged.keys()].sort();
  return { dates, rates: merged };
}

// ---------------------------------------------------------------------------
// parseAndMergeNbpCsvs — load multiple yearly files into one NbpTable
// ---------------------------------------------------------------------------

/**
 * Parses one or more NBP Table A CSV strings (e.g. one file per year as
 * downloaded from nbp.pl) and merges them into a single `NbpTable`.
 *
 * Each CSV is parsed independently so differing column sets across years
 * (e.g. HRK present in 2020 but removed later) are handled correctly.
 *
 * Throws if the array is empty or any CSV cannot be parsed.
 */
export function parseAndMergeNbpCsvs(csvFiles: string[]): NbpTable {
  if (csvFiles.length === 0) throw new Error("parseAndMergeNbpCsvs: no CSV files provided");

  let table = parseNbpCsv(csvFiles[0]!);
  for (let i = 1; i < csvFiles.length; i++) {
    const next = parseNbpCsv(csvFiles[i]!);
    table = mergeNbpRates(table, next.rates);
  }
  return table;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Binary search: returns the largest value in `sortedDates` that is strictly
 * less than `target`. Returns `undefined` if no such value exists.
 */
function findPriorDate(sortedDates: readonly string[], target: string): string | undefined {
  let lo = 0;
  let hi = sortedDates.length - 1;
  let result: string | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedDates[mid]! < target) {
      result = sortedDates[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}
