import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  parseAndMergeNbpCsvs,
  parseNbpCsv,
  mergeNbpRates,
  parseDegiroTrades,
  parseDegiroAccount,
  parseIbkrActivity,
  detectMissingRates,
  resolveAndFetchMissing,
  enrichTransactions,
  resolveIsinSymbols,
  primeIsinCache,
  getIsinCache,
  type Transaction,
  type NbpTable,
} from "@pit38/tax-engine";
import { mergeDedup } from "@/lib/dedup";
import {
  listUploadedNbpFiles,
  saveUploadedNbpFile,
  deleteUploadedNbpFile,
  type StoredNbpFile,
} from "@/lib/nbpRatesStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; added: number; duplicatesSkipped: number }
  | { state: "error"; message: string };

export interface UploadSlotState {
  fileName: string | null;
  status: UploadStatus;
}

const IDLE_SLOT: UploadSlotState = { fileName: null, status: { state: "idle" } };

export type UploadSlot =
  | "degiro-trades"
  | "degiro-account"
  | "ibkr-stocks";

export interface CustomNbpFileInfo {
  fileName: string;
  addedAt: string;
}

export type NbpUploadStatus =
  | { state: "idle" }
  | { state: "loading" }
  | {
      state: "done";
      addedFiles: number;
      failedFiles: { fileName: string; message: string }[];
    };

interface TransactionCtx {
  transactions: Transaction[];
  nbpTable: NbpTable | null;
  nbpReady: boolean;
  slotState: Record<UploadSlot, UploadSlotState>;
  uploadFile: (slot: UploadSlot, file: File) => Promise<void>;
  customNbpFiles: CustomNbpFileInfo[];
  nbpUploadStatus: NbpUploadStatus;
  uploadNbpRateFiles: (files: File[]) => Promise<void>;
  removeNbpRateFile: (fileName: string) => Promise<void>;
}

const TransactionContext = createContext<TransactionCtx | null>(null);

// ---------------------------------------------------------------------------
// NBP rate loading (once at app start)
// ---------------------------------------------------------------------------

const NBP_BASE_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

async function loadBundledNbpRates(): Promise<NbpTable> {
  // Always attempt to load the current year so transactions from the ongoing
  // year are covered without a bundled file update. Missing files (404) are
  // skipped gracefully — the NBP API will fill any remaining gaps.
  const currentYear = new Date().getFullYear();
  const years =
    currentYear > NBP_BASE_YEARS[NBP_BASE_YEARS.length - 1]!
      ? [...NBP_BASE_YEARS, currentYear]
      : NBP_BASE_YEARS;

  const results = await Promise.all(
    years.map(async (year) => {
      const res = await fetch(`/nbp_rates/archiwum_tab_a_${year}.csv`);
      if (!res.ok) return null; // 404 — file not bundled yet
      // Guard against SPA fallback: Vite (and many static hosts) return
      // index.html with status 200 for unknown paths. Reject HTML responses.
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) return null;
      return res.text();
    }),
  );

  const texts = results.filter((t): t is string => t !== null);
  if (texts.length === 0)
    throw new Error("Cannot load any bundled NBP rates — check the public/nbp_rates folder");
  return parseAndMergeNbpCsvs(texts);
}

// ---------------------------------------------------------------------------
// Custom (uploaded) NBP rates — folded on top of the bundled table
// ---------------------------------------------------------------------------

/** Merges stored custom rate files on top of a base table, skipping any that no longer parse. */
function applyStoredNbpFiles(base: NbpTable, stored: StoredNbpFile[]): NbpTable {
  let table = base;
  for (const file of stored) {
    try {
      const parsed = parseNbpCsv(file.text);
      table = mergeNbpRates(table, parsed.rates);
    } catch {
      // A previously-stored file no longer parses (corrupted/edited) — skip it
      // rather than blocking the whole table from loading.
    }
  }
  return table;
}

function toCustomFileInfo(stored: StoredNbpFile[]): CustomNbpFileInfo[] {
  return stored
    .map(({ fileName, addedAt }) => ({ fileName, addedAt }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

// ---------------------------------------------------------------------------
// Per-slot parser mapping
// ---------------------------------------------------------------------------

function parseSlot(slot: UploadSlot, text: string) {
  switch (slot) {
    case "degiro-trades":
      return parseDegiroTrades(text);
    case "degiro-account":
      return parseDegiroAccount(text);
    case "ibkr-stocks":
      return parseIbkrActivity(text);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function TransactionProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [nbpTable, setNbpTable] = useState<NbpTable | null>(null);
  const [nbpReady, setNbpReady] = useState(false);
  const [slotState, setSlotState] = useState<
    Record<UploadSlot, UploadSlotState>
  >({
    "degiro-trades": IDLE_SLOT,
    "degiro-account": IDLE_SLOT,
    "ibkr-stocks": IDLE_SLOT,
  });
  const [customNbpFiles, setCustomNbpFiles] = useState<CustomNbpFileInfo[]>([]);
  const [nbpUploadStatus, setNbpUploadStatus] = useState<NbpUploadStatus>({ state: "idle" });

  // Load bundled NBP rates once on mount, fold in any previously-uploaded
  // custom rate files from IndexedDB, and restore the ISIN cache from localStorage.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("pit38_isin_cache");
      if (stored) primeIsinCache(JSON.parse(stored));
    } catch { /* ignore */ }

    (async () => {
      try {
        const bundled = await loadBundledNbpRates();
        const storedFiles = await listUploadedNbpFiles();
        setNbpTable(applyStoredNbpFiles(bundled, storedFiles));
        setCustomNbpFiles(toCustomFileInfo(storedFiles));
        setNbpReady(true);
      } catch (err) {
        console.error("Failed to load NBP rates:", err);
        setNbpReady(false);
      }
    })();
  }, []);

  const setSlot = useCallback(
    (slot: UploadSlot, update: Partial<UploadSlotState>) =>
      setSlotState((prev) => ({ ...prev, [slot]: { ...prev[slot], ...update } })),
    [],
  );

  const uploadFile = useCallback(
    async (slot: UploadSlot, file: File) => {
      setSlot(slot, {
        fileName: file.name,
        status: { state: "loading" },
      });

      try {
        // 1 — Parse CSV
        const text = await file.text();
        const rawTxs = parseSlot(slot, text);

        // 2 — Resolve ISIN symbols → tickers (DEGIRO only)
        if (slot === "degiro-trades" || slot === "degiro-account") {
          await resolveIsinSymbols(rawTxs);
          try {
            localStorage.setItem("pit38_isin_cache", JSON.stringify(getIsinCache()));
          } catch { /* ignore quota errors */ }
        }

        // 3 — Get or wait for NBP table
        let table = nbpTable;
        if (!table) {
          table = await loadBundledNbpRates();
          setNbpTable(table);
          setNbpReady(true);
        }

        // 4 — Fill any rate gaps
        const missing = detectMissingRates(rawTxs, table);
        if (missing.length > 0) {
          table = await resolveAndFetchMissing(table, missing);
          setNbpTable(table);
        }

        // 5 — Enrich
        const enriched = enrichTransactions(rawTxs, table);

        // 6 — Merge with dedup
        setTransactions((prev) => {
          const { merged, duplicatesSkipped } = mergeDedup(prev, enriched);
          setSlot(slot, {
            status: {
              state: "done",
              added: enriched.length - duplicatesSkipped,
              duplicatesSkipped,
            },
          });
          return merged;
        });
      } catch (err) {
        setSlot(slot, {
          status: {
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },
    [nbpTable, setSlot],
  );

  const uploadNbpRateFiles = useCallback(
    async (files: File[]) => {
      setNbpUploadStatus({ state: "loading" });

      let table = nbpTable;
      if (!table) {
        table = await loadBundledNbpRates();
      }

      const failedFiles: { fileName: string; message: string }[] = [];
      let addedFiles = 0;

      for (const file of files) {
        try {
          const text = await file.text();
          const parsed = parseNbpCsv(text); // throws on an unrecognized/corrupt CSV
          table = mergeNbpRates(table, parsed.rates);
          await saveUploadedNbpFile(file.name, text);
          addedFiles += 1;
        } catch (err) {
          failedFiles.push({
            fileName: file.name,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      setNbpTable(table);
      setNbpReady(true);
      setCustomNbpFiles(toCustomFileInfo(await listUploadedNbpFiles()));
      setNbpUploadStatus({ state: "done", addedFiles, failedFiles });
    },
    [nbpTable],
  );

  const removeNbpRateFile = useCallback(async (fileName: string) => {
    await deleteUploadedNbpFile(fileName);
    const bundled = await loadBundledNbpRates();
    const storedFiles = await listUploadedNbpFiles();
    setNbpTable(applyStoredNbpFiles(bundled, storedFiles));
    setCustomNbpFiles(toCustomFileInfo(storedFiles));
  }, []);

  return (
    <TransactionContext.Provider
      value={{
        transactions,
        nbpTable,
        nbpReady,
        slotState,
        uploadFile,
        customNbpFiles,
        nbpUploadStatus,
        uploadNbpRateFiles,
        removeNbpRateFile,
      }}
    >
      {children}
    </TransactionContext.Provider>
  );
}

export function useTransactions() {
  const ctx = useContext(TransactionContext);
  if (!ctx)
    throw new Error("useTransactions must be used inside TransactionProvider");
  return ctx;
}
