import { useMemo } from "react";
import Decimal from "decimal.js";
import { calculateTax } from "@pit38/tax-engine";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useLossCarryForward } from "@/contexts/LossCarryForwardContext";
import { formatPLN } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

function gainClass(d: Decimal) {
  if (d.gt(0)) return "text-emerald-600 dark:text-emerald-400";
  if (d.lt(0)) return "text-rose-600 dark:text-rose-400";
  return "text-muted-foreground";
}

function parseDecimalSafe(s: string): Decimal | null {
  if (!s.trim()) return null;
  try {
    const d = new Decimal(s.replace(",", "."));
    return d.isNaN() || d.lt(0) ? null : d;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

interface ModeToggleProps {
  value: "auto" | "manual";
  onChange: (v: "auto" | "manual") => void;
  labels: [string, string];
}

function ModeToggle({ value, onChange, labels }: ModeToggleProps) {
  return (
    <div className="inline-flex rounded-md border overflow-hidden text-sm">
      {(["auto", "manual"] as const).map((m, i) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={cn(
            "px-4 py-1.5 transition-colors",
            value === m
              ? "bg-primary text-primary-foreground font-medium"
              : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            i === 0 ? "" : "border-l",
          )}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year-by-year preview table
// ---------------------------------------------------------------------------

interface PreviewRow {
  year: number;
  gainLoss: Decimal;
  carryApplied: Decimal;
  taxBase: Decimal;
  taxDue: Decimal;
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border">
      <Table className="[&_td]:py-2 [&_th]:py-2 text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>{t("lcf_colYear")}</TableHead>
            <TableHead className="text-right">{t("lcf_colGainLoss")}</TableHead>
            <TableHead className="text-right">{t("lcf_colCarryApplied")}</TableHead>
            <TableHead className="text-right">{t("lcf_colTaxBase")}</TableHead>
            <TableHead className="text-right">{t("lcf_colTaxDue")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.year}>
              <TableCell className="font-medium">{r.year}</TableCell>
              <TableCell className={cn("text-right font-mono tabular-nums", gainClass(r.gainLoss))}>
                {formatPLN(r.gainLoss)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.carryApplied.gt(0)
                  ? <span className="text-sky-600 dark:text-sky-400">−{formatPLN(r.carryApplied)}</span>
                  : <span className="text-muted-foreground/40">—</span>}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatPLN(r.taxBase)}
              </TableCell>
              <TableCell className={cn(
                "text-right font-mono tabular-nums font-semibold",
                r.taxDue.gt(0) ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground/40",
              )}>
                {r.taxDue.gt(0) ? formatPLN(r.taxDue) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual entries form
// ---------------------------------------------------------------------------

function ManualEntriesForm() {
  const { t } = useI18n();
  const { entries, addEntry, updateEntry, removeEntry } = useLossCarryForward();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("lcf_priorLossesTitle")}</p>
        <Button size="sm" variant="outline" onClick={addEntry}>
          + {t("lcf_addEntry")}
        </Button>
      </div>

      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("lcf_noEntries")}</p>
      )}

      {entries.length > 0 && (
        <div className="rounded-md border">
          <Table className="[&_td]:py-1.5 [&_th]:py-2 text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t("lcf_colEntryYear")}</TableHead>
                <TableHead>{t("lcf_colEntryLoss")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const parsed = parseDecimalSafe(entry.lossStr);
                const invalid = entry.lossStr.trim() !== "" && parsed === null;
                return (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Input
                        type="number"
                        min={2000}
                        max={2099}
                        step={1}
                        value={entry.year}
                        onChange={(e) =>
                          updateEntry(entry.id, { year: Number(e.target.value) })
                        }
                        className="h-7 w-24 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={entry.lossStr}
                          onChange={(e) =>
                            updateEntry(entry.id, { lossStr: e.target.value })
                          }
                          className={cn(
                            "h-7 w-40 text-xs font-mono",
                            invalid ? "border-rose-400 focus-visible:ring-rose-400" : "",
                          )}
                        />
                        <span className="text-xs text-muted-foreground">PLN</span>
                        {parsed !== null && (
                          <span className="text-xs text-muted-foreground font-mono">
                            = {formatPLN(parsed)}
                          </span>
                        )}
                        {invalid && (
                          <span className="text-xs text-rose-500">
                            {t("lcf_invalidAmount")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => removeEntry(entry.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors px-1"
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("lcf_priorLossesHint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function LossCarryForwardPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();
  const { options } = useSettings();
  const { mode, setMode, entries } = useLossCarryForward();

  // Build prior-year losses from valid manual entries
  const priorYearLosses = useMemo(() => {
    if (mode !== "manual") return [];
    return entries
      .map((e) => ({ year: e.year, lossAmountPLN: parseDecimalSafe(e.lossStr) }))
      .filter((e): e is { year: number; lossAmountPLN: Decimal } => e.lossAmountPLN !== null && e.lossAmountPLN.gt(0));
  }, [mode, entries]);

  // Run tax calculation with carry-forward enabled + any manual prior entries
  const taxResult = useMemo(() => {
    if (transactions.length === 0) return null;
    try {
      return calculateTax(transactions, {
        ...options,
        lossCarryForward: true,
        priorYearLosses,
      });
    } catch {
      return null;
    }
  }, [transactions, options, priorYearLosses]);

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!taxResult) return [];
    return [...taxResult.values()].map((s) => ({
      year: s.year,
      gainLoss: s.equity.totalGainLossPLN,
      carryApplied: s.equity.lossCarryForwardDeducted,
      taxBase: s.equity.taxBase,
      taxDue: s.equity.taxDue,
    }));
  }, [taxResult]);

  // Losses from the uploaded data (auto-detected), for info in auto mode
  const dataLosses = useMemo(() => {
    if (!taxResult) return [];
    return [...taxResult.values()]
      .filter((s) => s.equity.totalGainLossPLN.lt(0))
      .map((s) => ({ year: s.year, loss: s.equity.totalGainLossPLN.abs() }));
  }, [taxResult]);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Mode toggle */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("lcf_modeLabel")}</p>
        <ModeToggle
          value={mode}
          onChange={setMode}
          labels={[t("lcf_modeAuto"), t("lcf_modeManual")]}
        />
        <p className="text-xs text-muted-foreground">
          {mode === "auto" ? t("lcf_modeAutoDesc") : t("lcf_modeManualDesc")}
        </p>
      </div>

      {transactions.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("lcf_noData")}</p>
      )}

      {/* Manual entries (manual mode only) */}
      {mode === "manual" && transactions.length > 0 && (
        <ManualEntriesForm />
      )}

      {/* Auto mode: show detected losses from data */}
      {mode === "auto" && dataLosses.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("lcf_detectedLossesTitle")}</p>
          <div className="rounded-md border divide-y text-xs">
            {dataLosses.map(({ year, loss }) => (
              <div key={year} className="flex items-center justify-between px-4 py-2">
                <span className="font-medium">{year}</span>
                <span className="font-mono tabular-nums text-rose-600 dark:text-rose-400">
                  −{formatPLN(loss)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("lcf_detectedLossesHint")}</p>
        </div>
      )}

      {/* Year-by-year preview */}
      {previewRows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("lcf_previewTitle")}</p>
          <PreviewTable rows={previewRows} />
          <p className="text-xs text-muted-foreground">{t("lcf_previewHint")}</p>
        </div>
      )}

      {transactions.length > 0 && previewRows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("lcf_noEquityData")}</p>
      )}
    </div>
  );
}
