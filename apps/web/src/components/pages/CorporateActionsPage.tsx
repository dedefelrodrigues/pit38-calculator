import { useMemo } from "react";
import Decimal from "decimal.js";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import { computeRunningPositions } from "@pit38/tax-engine";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Transaction } from "@pit38/tax-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

/** Format a split ratio as a human-readable string, e.g. "10:1" or "1:2". */
function formatRatio(ratio: Decimal): string {
  if (ratio.gte(1)) {
    // Forward split: e.g. ratio=10 → "10:1"
    // Use toFixed(6) so the string always has a decimal point ("10.000000"),
    // preventing the regex from eating significant zeros (e.g. "10" → "1").
    const r = ratio.toFixed(6).replace(/\.?0+$/, "");
    return `${r}:1`;
  }
  // Reverse split: e.g. ratio=0.5 → "1:2"
  const inv = new Decimal(1).div(ratio).toDecimalPlaces(6);
  const r = inv.toFixed(6).replace(/\.?0+$/, "");
  return `1:${r}`;
}

interface CorporateActionRow {
  tx: Transaction;
  ratio: Decimal;
  positionBefore: Decimal;
  positionAfter: Decimal;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CorporateActionsPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();

  const rows = useMemo((): CorporateActionRow[] => {
    const splits = transactions.filter((tx) => tx.type === "STOCK_SPLIT");
    if (splits.length === 0) return [];

    const posMap = computeRunningPositions(transactions);

    return splits
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((tx) => {
        const ratio = tx.quantity ?? ZERO;
        const positionAfter = posMap.get(tx.id) ?? ZERO;
        // positionAfter = positionBefore × ratio  →  positionBefore = positionAfter / ratio
        const positionBefore = ratio.isZero()
          ? ZERO
          : positionAfter.div(ratio);
        return { tx, ratio, positionBefore, positionAfter };
      });
  }, [transactions]);

  if (rows.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("ca_noData")}
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table className="[&_td]:py-1.5 [&_th]:py-2 text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>{t("tx_colDate")}</TableHead>
            <TableHead>{t("tx_colSymbol")}</TableHead>
            <TableHead>{t("tx_colAction")}</TableHead>
            <TableHead>{t("tx_colRatio")}</TableHead>
            <TableHead>{t("tx_colBroker")}</TableHead>
            <TableHead className="text-right">{t("tx_colPosBefore")}</TableHead>
            <TableHead className="text-right">{t("tx_colPosAfter")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ tx, ratio, positionBefore, positionAfter }) => {
            const isForward = ratio.gte(1);
            return (
              <TableRow key={tx.id} className="h-8">
                <TableCell className="font-mono">{tx.date}</TableCell>
                <TableCell className="font-mono font-medium">{tx.symbol}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs font-medium",
                      isForward
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : "bg-amber-50 text-amber-700 border-amber-200",
                    )}
                  >
                    {isForward ? t("ca_forwardSplit") : t("ca_reverseSplit")}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono font-medium">
                  {formatRatio(ratio)}
                </TableCell>
                <TableCell className="capitalize text-muted-foreground">
                  {tx.broker}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {formatQty(positionBefore)}
                </TableCell>
                <TableCell className="text-right font-mono font-medium">
                  {formatQty(positionAfter)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
