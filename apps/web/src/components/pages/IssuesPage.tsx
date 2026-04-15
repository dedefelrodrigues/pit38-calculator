import Decimal from "decimal.js";
import { useMemo } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isIsin, processFifo } from "@pit38/tax-engine";
import type { Transaction } from "@pit38/tax-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueSeverity = "error" | "warning" | "info";

export interface Issue {
  id: string;
  severity: IssueSeverity;
  category: string;
  message: string;
  context?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY = "2026-04-15";

/** Number of calendar days between two ISO date strings. */
function calendarDaysBetween(earlier: string, later: string): number {
  return Math.round(
    (new Date(later).getTime() - new Date(earlier).getTime()) / 86_400_000,
  );
}

function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const styles: Record<IssueSeverity, string> = {
    error:   "bg-rose-50   text-rose-700   border-rose-200   dark:bg-rose-950/60   dark:text-rose-300   dark:border-rose-700",
    warning: "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/60  dark:text-amber-300  dark:border-amber-700",
    info:    "bg-sky-50    text-sky-700    border-sky-200    dark:bg-sky-950/60    dark:text-sky-300    dark:border-sky-700",
  };
  return (
    <Badge variant="outline" className={cn("text-xs font-medium capitalize", styles[severity])}>
      {severity}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

/** [ERROR] SELLs where the FIFO engine would throw (insufficient shares). */
function checkMissingBuyLots(transactions: Transaction[]): Issue[] {
  const issues: Issue[] = [];
  const buySellSplit = transactions.filter(
    (tx) => tx.type === "BUY" || tx.type === "SELL" || tx.type === "STOCK_SPLIT",
  );

  // Group by symbol and run FIFO per symbol to isolate which ones fail
  const symbols = [...new Set(buySellSplit.map((tx) => tx.symbol))];
  for (const symbol of symbols) {
    const symbolTxs = buySellSplit.filter((tx) => tx.symbol === symbol);
    try {
      processFifo(symbolTxs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Extract the sell date from the error message if possible
      const dateMatch = msg.match(/(\d{4}-\d{2}-\d{2})/);
      const context = dateMatch ? `${symbol} @ ${dateMatch[1]}` : symbol;
      issues.push({
        id: `missing-lots-${symbol}`,
        severity: "error",
        category: "Missing buy lots",
        message: `SELL has no open FIFO lots — insufficient shares. Likely cause: partial history uploaded (missing earlier buys).`,
        context,
      });
    }
  }
  return issues;
}

/** [ERROR] Zero or missing FX rate on any enriched transaction. */
function checkZeroFxRate(transactions: Transaction[]): Issue[] {
  return transactions
    .filter((tx) => tx.currency !== "PLN" && tx.fxRate.lte(0))
    .map((tx, i) => ({
      id: `zero-fx-${tx.id}-${i}`,
      severity: "error" as const,
      category: "Zero FX rate",
      message: `FX rate is zero or missing — PLN amounts will be wrong. NBP lookup likely failed.`,
      context: `${tx.symbol} ${tx.type} @ ${tx.date} (${tx.currency})`,
    }));
}

/** [ERROR] Negative running position — SELL processed before matching BUY. */
function checkNegativeRunningPosition(transactions: Transaction[]): Issue[] {
  const issues: Issue[] = [];
  const buySellSplit = transactions
    .filter((tx) => tx.type === "BUY" || tx.type === "SELL" || tx.type === "STOCK_SPLIT")
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      const order: Record<string, number> = { STOCK_SPLIT: 0, BUY: 1, SELL: 2 };
      return (order[a.type] ?? 3) - (order[b.type] ?? 3);
    });

  const positions = new Map<string, Decimal>();
  const reported = new Set<string>();

  for (const tx of buySellSplit) {
    const prev = positions.get(tx.symbol) ?? new Decimal(0);
    let next = prev;

    if (tx.type === "BUY") {
      next = prev.add(tx.quantity!);
    } else if (tx.type === "SELL") {
      next = prev.sub(tx.quantity!);
    } else if (tx.type === "STOCK_SPLIT") {
      next = prev.mul(tx.quantity!);
    }

    positions.set(tx.symbol, next);

    if (next.lt(0) && !reported.has(tx.symbol)) {
      reported.add(tx.symbol);
      issues.push({
        id: `neg-position-${tx.symbol}`,
        severity: "error",
        category: "Negative position",
        message: `Running position went negative — a SELL was processed before the matching BUY was loaded.`,
        context: `${tx.symbol} @ ${tx.date} (position: ${next.toFixed(4)})`,
      });
    }
  }
  return issues;
}

/** [WARNING] WHT entry with no matching DIVIDEND on (symbol, date). */
function checkOrphanedWithholdingTax(transactions: Transaction[]): Issue[] {
  const dividendKeys = new Set(
    transactions
      .filter((tx) => tx.type === "DIVIDEND")
      .map((tx) => `${tx.symbol}|${tx.date}`),
  );
  return transactions
    .filter((tx) => tx.type === "WITHHOLDING_TAX")
    .filter((tx) => !dividendKeys.has(`${tx.symbol}|${tx.date}`))
    .map((tx, i) => ({
      id: `orphan-wht-${tx.id}-${i}`,
      severity: "warning" as const,
      category: "Orphaned WHT",
      message: `Withholding tax entry has no matching DIVIDEND on the same symbol and date.`,
      context: `${tx.symbol} @ ${tx.date}`,
    }));
}

/** [WARNING] STOCK_SPLIT with no open lots at that date. */
function checkStockSplitWithoutPosition(transactions: Transaction[]): Issue[] {
  const issues: Issue[] = [];
  const relevant = transactions
    .filter((tx) => tx.type === "BUY" || tx.type === "SELL" || tx.type === "STOCK_SPLIT")
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      const order: Record<string, number> = { STOCK_SPLIT: 0, BUY: 1, SELL: 2 };
      return (order[a.type] ?? 3) - (order[b.type] ?? 3);
    });

  const positions = new Map<string, Decimal>();

  for (const tx of relevant) {
    if (tx.type === "BUY") {
      positions.set(tx.symbol, (positions.get(tx.symbol) ?? new Decimal(0)).add(tx.quantity!));
    } else if (tx.type === "SELL") {
      positions.set(tx.symbol, (positions.get(tx.symbol) ?? new Decimal(0)).sub(tx.quantity!));
    } else if (tx.type === "STOCK_SPLIT") {
      const pos = positions.get(tx.symbol) ?? new Decimal(0);
      if (pos.lte(0)) {
        issues.push({
          id: `split-no-pos-${tx.id}`,
          severity: "warning",
          category: "Split without position",
          message: `Stock split applied but no open lots exist — split is a no-op. Likely cause: missing buy history.`,
          context: `${tx.symbol} @ ${tx.date} (ratio: ${tx.quantity?.toFixed(4) ?? "?"})`,
        });
      } else {
        positions.set(tx.symbol, pos.mul(tx.quantity!));
      }
    }
  }
  return issues;
}

/** [WARNING] fxRate deviates >20% from the median of adjacent transactions for the same currency. */
function checkLargeNbpRateDelta(transactions: Transaction[]): Issue[] {
  const issues: Issue[] = [];
  // Group by currency, sorted by date
  const byCurrency = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.currency === "PLN" || tx.fxRate.lte(0)) continue;
    if (!byCurrency.has(tx.currency)) byCurrency.set(tx.currency, []);
    byCurrency.get(tx.currency)!.push(tx);
  }

  for (const [currency, txs] of byCurrency) {
    if (txs.length < 3) continue;
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length - 1; i++) {
      const prev = sorted[i - 1]!.fxRate;
      const curr = sorted[i]!.fxRate;
      const next = sorted[i + 1]!.fxRate;
      const neighborMedian = prev.add(next).div(2);
      if (neighborMedian.lte(0)) continue;
      const delta = curr.sub(neighborMedian).abs().div(neighborMedian);
      if (delta.gt(0.2)) {
        const tx = sorted[i]!;
        issues.push({
          id: `fx-delta-${tx.id}`,
          severity: "warning",
          category: "Large FX rate delta",
          message: `FX rate deviates ${delta.mul(100).toFixed(1)}% from neighbouring rates — possible CSV parse error or wrong-year file loaded.`,
          context: `${currency} @ ${tx.date} (rate: ${curr.toFixed(4)}, neighbours: ${prev.toFixed(4)} / ${next.toFixed(4)})`,
        });
      }
    }
  }
  return issues;
}

/** [WARNING] Two transactions share the same broker-assigned ID. */
function checkDuplicateTransactionIds(transactions: Transaction[]): Issue[] {
  const seen = new Map<string, Transaction>();
  const issues: Issue[] = [];
  const reported = new Set<string>();

  for (const tx of transactions) {
    const key = `${tx.broker}|${tx.id}`;
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key);
      const first = seen.get(key)!;
      issues.push({
        id: `dup-id-${key}`,
        severity: "warning",
        category: "Duplicate transaction ID",
        message: `Two transactions share broker ID "${tx.id}" — the dedup layer skipped one silently. Verify this is intentional.`,
        context: `${tx.broker} / ${tx.symbol} @ ${first.date} and ${tx.date}`,
      });
    } else {
      seen.set(key, tx);
    }
  }
  return issues;
}

/** [WARNING] Transaction date is after today. */
function checkFutureTransactions(transactions: Transaction[]): Issue[] {
  return transactions
    .filter((tx) => tx.date > TODAY)
    .map((tx, i) => ({
      id: `future-tx-${tx.id}-${i}`,
      severity: "warning" as const,
      category: "Future-dated transaction",
      message: `Transaction is dated in the future — likely a day/month swap in the CSV parser.`,
      context: `${tx.symbol} ${tx.type} @ ${tx.date}`,
    }));
}

/** [INFO] Symbol still in ISIN format after resolution attempt. */
function checkUnresolvedIsins(transactions: Transaction[]): Issue[] {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const tx of transactions) {
    if (isIsin(tx.symbol) && !seen.has(tx.symbol)) {
      seen.add(tx.symbol);
      issues.push({
        id: `unresolved-isin-${tx.symbol}`,
        severity: "info",
        category: "Unresolved ISIN",
        message: `Symbol is still in ISIN format after resolution — OpenFIGI may not have coverage. Map it manually if needed.`,
        context: tx.symbol,
      });
    }
  }
  return issues;
}

/**
 * [INFO] fxDate is significantly earlier than tx date (>5 calendar days apart,
 * roughly >5 business days). Rate was fetched live; worth verifying.
 */
function checkNbpRateGaps(transactions: Transaction[]): Issue[] {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const tx of transactions) {
    if (tx.currency === "PLN") continue;
    const gap = calendarDaysBetween(tx.fxDate, tx.date);
    // >7 calendar days ≈ >5 business days accounting for weekends
    if (gap > 7) {
      const key = `${tx.symbol}|${tx.date}|${tx.fxDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          id: `nbp-gap-${tx.id}`,
          severity: "info",
          category: "NBP rate gap",
          message: `NBP rate sourced ${gap} calendar days before transaction — may have been fetched live from the API. Verify the rate looks correct.`,
          context: `${tx.symbol} ${tx.type} @ ${tx.date} (fxDate: ${tx.fxDate})`,
        });
      }
    }
  }
  return issues;
}

/** [INFO] Same symbol appears with different currencies. */
function checkMixedCurrencySymbol(transactions: Transaction[]): Issue[] {
  const symbolCurrencies = new Map<string, Set<string>>();
  for (const tx of transactions) {
    if (!symbolCurrencies.has(tx.symbol)) symbolCurrencies.set(tx.symbol, new Set());
    symbolCurrencies.get(tx.symbol)!.add(tx.currency);
  }
  const issues: Issue[] = [];
  for (const [symbol, currencies] of symbolCurrencies) {
    if (currencies.size > 1) {
      issues.push({
        id: `mixed-currency-${symbol}`,
        severity: "info",
        category: "Mixed currency",
        message: `Symbol appears with multiple currencies — may indicate a ticker collision between two different securities.`,
        context: `${symbol}: ${[...currencies].join(", ")}`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

export function IssuesPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();

  const issues = useMemo<Issue[]>(() => {
    if (transactions.length === 0) return [];
    return [
      ...checkMissingBuyLots(transactions),
      ...checkZeroFxRate(transactions),
      ...checkNegativeRunningPosition(transactions),
      ...checkOrphanedWithholdingTax(transactions),
      ...checkStockSplitWithoutPosition(transactions),
      ...checkLargeNbpRateDelta(transactions),
      ...checkDuplicateTransactionIds(transactions),
      ...checkFutureTransactions(transactions),
      ...checkUnresolvedIsins(transactions),
      ...checkNbpRateGaps(transactions),
      ...checkMixedCurrencySymbol(transactions),
    ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [transactions]);

  if (transactions.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("issues_noData")}
      </p>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="py-16 text-center space-y-2">
        <p className="text-sm font-medium">{t("issues_noIssues")}</p>
        <p className="text-xs text-muted-foreground">All {transactions.length} transactions passed all checks.</p>
      </div>
    );
  }

  const errorCount   = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount    = issues.filter((i) => i.severity === "info").length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{issues.length} issue{issues.length !== 1 ? "s" : ""} found</span>
        {errorCount > 0 && (
          <span className="text-rose-600 dark:text-rose-400 font-medium">
            {errorCount} error{errorCount !== 1 ? "s" : ""}
          </span>
        )}
        {warningCount > 0 && (
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            {warningCount} warning{warningCount !== 1 ? "s" : ""}
          </span>
        )}
        {infoCount > 0 && (
          <span className="text-sky-600 dark:text-sky-400 font-medium">
            {infoCount} info
          </span>
        )}
      </div>

      <div className="rounded-md border">
        <Table className="[&_td]:py-1.5 [&_th]:py-2 text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{t("issues_colSeverity")}</TableHead>
              <TableHead>{t("issues_colCategory")}</TableHead>
              <TableHead>{t("issues_colMessage")}</TableHead>
              <TableHead>{t("issues_colContext")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((issue) => (
              <TableRow key={issue.id} className="h-8">
                <TableCell><SeverityBadge severity={issue.severity} /></TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">{issue.category}</TableCell>
                <TableCell>{issue.message}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{issue.context ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
