import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
// Checks (to be implemented — stubs returning [])
// ---------------------------------------------------------------------------

// TODO: implement each check function; each returns Issue[]

// function checkMissingBuyLots(transactions): Issue[]
//   Detects SELLs where the FIFO engine would throw (insufficient open lots).
//   Severity: error. Likely cause: partial export — only part of the history uploaded.

// function checkOrphanedWithholdingTax(transactions): Issue[]
//   WHT entries that have no matching DIVIDEND on the same (symbol, date).
//   Severity: warning. Could indicate a date mismatch or missing dividend row.

// function checkDuplicateTransactionIds(transactions): Issue[]
//   Transactions sharing the same broker-assigned ID across files.
//   Severity: warning. The dedup logic skips them, but it's worth surfacing.

// function checkUnresolvedIsins(transactions): Issue[]
//   Symbols that are still in ISIN format (US000000000 pattern) after ISIN
//   resolution. Severity: info. OpenFIGI may not have coverage for all ISINs.

// function checkNbpRateGaps(transactions, nbpTable): Issue[]
//   Transactions where the NBP rate had to be fetched live from the API
//   (fxDate significantly older than tx date — e.g. >5 business days back).
//   Severity: info. Could indicate a public holiday block or API issue.

// function checkLargeNbpRateDelta(transactions): Issue[]
//   Transactions where fxRate deviates significantly from adjacent rates,
//   suggesting an NBP CSV parse error or a wrong-year file was loaded.
//   Severity: warning.

// function checkNegativeOpenPosition(transactions): Issue[]
//   Any symbol whose running position goes negative at any point — this means
//   a SELL was processed before the matching BUY was loaded.
//   Severity: error.

// function checkStockSplitWithoutPosition(transactions): Issue[]
//   STOCK_SPLIT with no open lots for the symbol at that date — the split is
//   a no-op, which is usually a sign of missing buy history.
//   Severity: warning.

// function checkZeroFxRate(transactions): Issue[]
//   Any enriched transaction where fxRate = 0 or is missing.
//   Severity: error.

// function checkFutureTransactions(transactions): Issue[]
//   Transactions dated in the future (after today's date).
//   Could indicate a date parse bug in the CSV parser.
//   Severity: warning.

// function checkMixedCurrencySymbol(transactions): Issue[]
//   The same symbol appearing with different currencies across transactions,
//   which may indicate a ticker collision between two different securities.
//   Severity: info.

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function IssuesPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();

  // Placeholder: no checks implemented yet — always empty
  const issues: Issue[] = [];

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
        <p className="text-xs text-muted-foreground">Checks are not yet implemented.</p>
      </div>
    );
  }

  return (
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
              <TableCell className="text-muted-foreground">{issue.category}</TableCell>
              <TableCell>{issue.message}</TableCell>
              <TableCell className="font-mono text-muted-foreground">{issue.context ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
