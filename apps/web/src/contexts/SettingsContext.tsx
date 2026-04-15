import { createContext, useContext, useState, type ReactNode } from "react";
import type { CalculateTaxOptions } from "@pit38/tax-engine";

interface SettingsCtx {
  options: CalculateTaxOptions;
  setOption: <K extends keyof CalculateTaxOptions>(
    key: K,
    value: CalculateTaxOptions[K],
  ) => void;
}

const SettingsContext = createContext<SettingsCtx | null>(null);

/** All toggles off by default — user opts in explicitly. */
const DEFAULT_OPTIONS: CalculateTaxOptions = {
  includeOtherIncome: false,
  lossCarryForward: false,
  includeCyep: false,
  includeInterest: false,
  includeDividendAccruals: false,
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<CalculateTaxOptions>(DEFAULT_OPTIONS);

  function setOption<K extends keyof CalculateTaxOptions>(
    key: K,
    value: CalculateTaxOptions[K],
  ) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <SettingsContext.Provider value={{ options, setOption }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
