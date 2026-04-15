import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LcfMode = "auto" | "manual";

/** One user-supplied prior-year loss entry. */
export interface ManualLossEntry {
  /** Stable key for React rendering. */
  id: string;
  year: number;
  /** Raw PLN string from the input field — may be empty or invalid while editing. */
  lossStr: string;
}

interface LcfCtx {
  mode: LcfMode;
  setMode: (m: LcfMode) => void;
  entries: ManualLossEntry[];
  addEntry: () => void;
  updateEntry: (id: string, patch: Partial<Pick<ManualLossEntry, "year" | "lossStr">>) => void;
  removeEntry: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const LossCarryForwardContext = createContext<LcfCtx | null>(null);

let _nextId = 0;
function nextId() { return String(++_nextId); }

const CURRENT_YEAR = new Date().getFullYear();

export function LossCarryForwardProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LcfMode>("auto");
  const [entries, setEntries] = useState<ManualLossEntry[]>([]);

  const addEntry = useCallback(() => {
    setEntries((prev) => [
      ...prev,
      { id: nextId(), year: CURRENT_YEAR - 1, lossStr: "" },
    ]);
  }, []);

  const updateEntry = useCallback(
    (id: string, patch: Partial<Pick<ManualLossEntry, "year" | "lossStr">>) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
    },
    [],
  );

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return (
    <LossCarryForwardContext.Provider
      value={{ mode, setMode, entries, addEntry, updateEntry, removeEntry }}
    >
      {children}
    </LossCarryForwardContext.Provider>
  );
}

export function useLossCarryForward() {
  const ctx = useContext(LossCarryForwardContext);
  if (!ctx)
    throw new Error("useLossCarryForward must be used inside LossCarryForwardProvider");
  return ctx;
}
