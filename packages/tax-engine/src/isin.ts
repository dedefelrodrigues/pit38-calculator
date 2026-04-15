/**
 * ISIN → ticker symbol resolution via the OpenFIGI public API.
 * https://www.openfigi.com/api
 *
 * Rate limits without an API key: 10 identifiers per request, 25 req/min.
 *
 * An in-memory cache avoids redundant lookups within a session.
 * Callers (e.g. a browser app) may layer their own persistent cache on top
 * by pre-populating the module cache via `primeIsinCache`.
 */

import type { RawTransaction } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{10}$/;
const BATCH_SIZE = 10; // OpenFIGI limit without API key
const OPENFIGI_URL = "https://api.openfigi.com/v3/mapping";

// ---------------------------------------------------------------------------
// In-memory cache (module-level, lives for the process/tab lifetime)
// ---------------------------------------------------------------------------

const _cache = new Map<string, string>(); // ISIN → ticker

/** Pre-populate the cache from an external persistent store (e.g. localStorage). */
export function primeIsinCache(entries: Record<string, string>): void {
  for (const [isin, ticker] of Object.entries(entries)) {
    _cache.set(isin, ticker);
  }
}

/** Returns a snapshot of the current cache (for persistence by callers). */
export function getIsinCache(): Record<string, string> {
  return Object.fromEntries(_cache);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FigiResult {
  ticker?: string;
  marketSector?: string;
}

interface FigiResponse {
  data?: FigiResult[];
  warning?: string;
}

/** Returns true when the string matches the ISIN format. */
export function isIsin(s: string): boolean {
  return ISIN_RE.test(s);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves ISIN symbols in `transactions` to their primary ticker symbols,
 * mutating `tx.symbol` in place. Transactions whose symbol is not an ISIN,
 * or whose ISIN cannot be resolved, are left unchanged.
 *
 * Requires `fetch` to be available in the runtime (browser or Node ≥ 18).
 */
export async function resolveIsinSymbols(
  transactions: RawTransaction[],
): Promise<void> {
  // Collect unique uncached ISINs present in this batch
  const uncached = [
    ...new Set(
      transactions
        .map((tx) => tx.symbol)
        .filter((s) => isIsin(s) && !_cache.has(s)),
    ),
  ];

  // Fetch in batches of BATCH_SIZE
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const body = batch.map((isin) => ({ idType: "ID_ISIN", idValue: isin }));

    let responses: FigiResponse[];
    try {
      const res = await fetch(OPENFIGI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      responses = (await res.json()) as FigiResponse[];
    } catch {
      // Network error — skip batch, symbols stay as ISINs.
      continue;
    }

    for (let j = 0; j < responses.length; j++) {
      const isin = batch[j];
      const entry = responses[j];
      if (!isin || !entry?.data) continue;

      // Prefer equity sector entries; fall back to any entry with a ticker.
      const pick =
        entry.data.find((d) => d.ticker && d.marketSector === "Equity") ??
        entry.data.find((d) => d.ticker);

      const ticker = pick?.ticker;
      if (ticker) _cache.set(isin, ticker);
    }
  }

  // Apply resolved tickers to the transactions
  for (const tx of transactions) {
    const ticker = _cache.get(tx.symbol);
    if (ticker) tx.symbol = ticker;
  }
}
