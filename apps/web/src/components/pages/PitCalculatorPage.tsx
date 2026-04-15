import { useState, useMemo } from "react";
import Decimal from "decimal.js";
import { calculateTax } from "@pit38/tax-engine";
import type { TaxSummary } from "@pit38/tax-engine";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import { useSettings } from "@/contexts/SettingsContext";
import { formatPLN } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

function gainClass(d: Decimal) {
  if (d.gt(0)) return "text-emerald-600 dark:text-emerald-400";
  if (d.lt(0)) return "text-rose-600 dark:text-rose-400";
  return "";
}

// ---------------------------------------------------------------------------
// A single labeled row in a summary section
// ---------------------------------------------------------------------------

interface SummaryRowProps {
  label: string;
  value: Decimal;
  bold?: boolean;
  dimZero?: boolean;
  colorGain?: boolean;
  indent?: boolean;
}

function SummaryRow({ label, value, bold, dimZero, colorGain, indent }: SummaryRowProps) {
  const isZero = value.isZero();
  return (
    <tr className={cn("border-b last:border-b-0", isZero && dimZero ? "opacity-40" : "")}>
      <td className={cn("py-1.5 text-sm text-muted-foreground", indent ? "pl-6" : "pl-4")}>
        {label}
      </td>
      <td
        className={cn(
          "py-1.5 pr-4 text-right font-mono text-sm tabular-nums",
          bold ? "font-semibold text-foreground" : "",
          colorGain ? gainClass(value) : "",
        )}
      >
        {formatPLN(value)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

function Section({ title, children, className }: SectionProps) {
  return (
    <div className={cn("rounded-lg border bg-card overflow-hidden", className)}>
      <div className="px-4 py-2 bg-muted/40 border-b">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      <table className="w-full">{children}</table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PIT-38 form reference table
// ---------------------------------------------------------------------------

interface FormRefRow {
  field: string;
  label: string;
  value: Decimal;
}

function FormRefTable({ rows }: { rows: FormRefRow[] }) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-2 bg-muted/40 border-b">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          PIT-38 Reference
        </span>
      </div>
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.field} className="border-b last:border-b-0">
              <td className="pl-4 py-1.5 text-xs font-mono text-muted-foreground w-20">{r.field}</td>
              <td className="py-1.5 text-sm text-muted-foreground">{r.label}</td>
              <td className="py-1.5 pr-4 text-right font-mono text-sm tabular-nums">
                {formatPLN(r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year summary view
// ---------------------------------------------------------------------------

function YearSummary({ summary, t }: { summary: TaxSummary; t: (k: Parameters<ReturnType<typeof useI18n>["t"]>[0]) => string }) {
  const { equity, dividends, otherIncome } = summary;
  const hasOther = !otherIncome.totalIncomePLN.isZero() || !otherIncome.totalCostPLN.isZero();
  const hasCarry = equity.lossCarryForwardDeducted.gt(0);

  const formRows: FormRefRow[] = [
    { field: "C.20", label: t("pit_pit38c20"), value: equity.totalRevenuePLN },
    { field: "C.21", label: t("pit_pit38c21"), value: equity.totalCostPLN },
    ...(equity.totalGainLossPLN.gte(0)
      ? [{ field: "C.22", label: t("pit_pit38c22"), value: equity.taxBase }]
      : [{ field: "C.23", label: t("pit_pit38c23"), value: equity.totalGainLossPLN.abs() }]),
    { field: "C.24", label: t("pit_pit38c24"), value: equity.taxDue },
    { field: "Div", label: t("pit_pit38divGross"), value: dividends.grossDividendsPLN },
    { field: "Div", label: t("pit_pit38divWht"), value: dividends.taxCredit },
    { field: "Div", label: t("pit_pit38divTax"), value: dividends.taxDue },
  ];

  return (
    <div className="space-y-4">
      {/* Total callout */}
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-5 py-4 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{t("pit_totalTaxDue")} {summary.year}</span>
        <span className={cn("text-2xl font-bold font-mono tabular-nums", summary.totalTaxDue.gt(0) ? "text-rose-600 dark:text-rose-400" : "")}>
          {formatPLN(summary.totalTaxDue)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Equity */}
        <Section title={t("pit_sectionEquity")}>
          <tbody>
            <SummaryRow label={t("pit_revenue")}   value={equity.totalRevenuePLN} />
            <SummaryRow label={t("pit_cost")}      value={equity.totalCostPLN} />
            <SummaryRow label={t("pit_gainLoss")}  value={equity.totalGainLossPLN}  colorGain bold />
            {hasCarry && (
              <SummaryRow label={t("pit_carryForward")} value={equity.lossCarryForwardDeducted} indent dimZero />
            )}
            <SummaryRow label={t("pit_taxBase")}   value={equity.taxBase}           dimZero />
            <SummaryRow label={t("pit_taxDue")}    value={equity.taxDue}            bold dimZero />
          </tbody>
        </Section>

        {/* Dividends */}
        <Section title={t("pit_sectionDividends")}>
          <tbody>
            <SummaryRow label={t("pit_grossDividends")}  value={dividends.grossDividendsPLN} />
            <SummaryRow label={t("pit_polishTax")}       value={dividends.polishTaxGross} />
            <SummaryRow label={t("pit_whtCredit")}       value={dividends.taxCredit}       indent dimZero />
            <SummaryRow label={t("pit_netDividendTax")}  value={dividends.taxDue}          bold />
          </tbody>
        </Section>

        {/* Other income (only if relevant) */}
        {hasOther && (
          <Section title={t("pit_sectionOther")}>
            <tbody>
              <SummaryRow label={t("pit_incomeOther")} value={otherIncome.totalIncomePLN} />
              <SummaryRow label={t("pit_costOther")}   value={otherIncome.totalCostPLN} />
              <SummaryRow label={t("pit_netOther")}    value={otherIncome.gainLossPLN} colorGain bold />
              <SummaryRow label={t("pit_taxDue")}      value={otherIncome.taxDue}       bold dimZero />
            </tbody>
          </Section>
        )}
      </div>

      {/* PIT-38 form reference */}
      <FormRefTable rows={formRows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PitCalculatorPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();
  const { options } = useSettings();

  const taxResult = useMemo(() => {
    if (transactions.length === 0) return null;
    try {
      return calculateTax(transactions, options);
    } catch {
      return null;
    }
  }, [transactions, options]);

  const years = useMemo(
    () => (taxResult ? [...taxResult.keys()] : []),
    [taxResult],
  );

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const activeYear = selectedYear ?? years[years.length - 1] ?? null;

  if (!taxResult || years.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("pit_noData")}
      </p>
    );
  }

  const summary = activeYear !== null ? taxResult.get(activeYear) : undefined;

  return (
    <div className="space-y-5">
      {/* Year tab strip */}
      <div className="flex gap-1.5 flex-wrap">
        {years.map((y) => {
          const s = taxResult.get(y)!;
          const isActive = y === activeYear;
          return (
            <button
              key={y}
              onClick={() => setSelectedYear(y)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-accent hover:text-accent-foreground text-muted-foreground",
              )}
            >
              {y}
              <span
                className={cn(
                  "ml-2 text-xs font-mono",
                  isActive ? "text-primary-foreground/80" : "text-muted-foreground/60",
                  s.totalTaxDue.gt(0) ? "text-rose-400" : "",
                )}
              >
                {formatPLN(s.totalTaxDue)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected year detail */}
      {summary && <YearSummary summary={summary} t={t} />}
    </div>
  );
}
