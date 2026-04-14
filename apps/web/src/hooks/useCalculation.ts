import { useState, useCallback } from "react";
import {
  parseAndMergeNbpCsvs,
  parseDegiroTrades,
  parseDegiroAccount,
  parseIbkrActivity,
  detectMissingRates,
  resolveAndFetchMissing,
  enrichTransactions,
  calculateTax,
} from "@pit38/tax-engine";
import type { TaxSummary } from "@pit38/tax-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Broker = "degiro" | "ibkr";

export type CalcStep =
  | "loading-rates"
  | "parsing"
  | "filling-gaps"
  | "enriching"
  | "calculating";

export type CalcState =
  | { status: "idle" }
  | { status: "running"; step: CalcStep }
  | {
      status: "done";
      results: Map<number, TaxSummary>;
      transactionCount: number;
      gapsFilled: number;
    }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// NBP rates loader
// ---------------------------------------------------------------------------

const NBP_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

async function loadBundledNbpRates() {
  const texts = await Promise.all(
    NBP_YEARS.map(async (year) => {
      const res = await fetch(`/nbp_rates/archiwum_tab_a_${year}.csv`);
      if (!res.ok)
        throw new Error(`Cannot load NBP rates for ${year}: ${res.status}`);
      // NBP CSVs are ISO-8859-2 but all rate/date data is ASCII — text() is fine.
      return res.text();
    }),
  );
  return parseAndMergeNbpCsvs(texts);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCalculation() {
  const [state, setState] = useState<CalcState>({ status: "idle" });

  const calculate = useCallback(
    async (broker: Broker, files: File[]) => {
      setState({ status: "running", step: "loading-rates" });

      try {
        // 1 — Load bundled NBP rates
        const baseTable = await loadBundledNbpRates();

        // 2 — Parse broker CSV(s)
        setState({ status: "running", step: "parsing" });
        let rawTxs;

        if (broker === "degiro") {
          const [tradesFile, accountFile] = files;
          if (!tradesFile || !accountFile)
            throw new Error("DEGIRO: dwa pliki są wymagane (trades + account)");
          const [tradesText, accountText] = await Promise.all([
            tradesFile.text(),
            accountFile.text(),
          ]);
          rawTxs = [
            ...parseDegiroTrades(tradesText),
            ...parseDegiroAccount(accountText),
          ];
        } else {
          const [activityFile] = files;
          if (!activityFile)
            throw new Error("IBKR: plik activity statement jest wymagany");
          const activityText = await activityFile.text();
          rawTxs = parseIbkrActivity(activityText);
        }

        if (rawTxs.length === 0)
          throw new Error("Nie znaleziono żadnych transakcji w pliku CSV");

        // 3 — Fill any rate gaps via NBP API
        setState({ status: "running", step: "filling-gaps" });
        const missing = detectMissingRates(rawTxs, baseTable);
        const fullTable =
          missing.length > 0
            ? await resolveAndFetchMissing(baseTable, missing)
            : baseTable;
        const gapsFilled = missing.length;

        // 4 — Enrich (apply FX rates → PLN amounts)
        setState({ status: "running", step: "enriching" });
        const transactions = enrichTransactions(rawTxs, fullTable);

        // 5 — Calculate tax
        setState({ status: "running", step: "calculating" });
        const results = calculateTax(transactions);

        setState({
          status: "done",
          results,
          transactionCount: transactions.length,
          gapsFilled,
        });
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, calculate, reset };
}
