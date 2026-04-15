import { useState, useMemo } from "react";
import Decimal from "decimal.js";
import { ChevronRight, ChevronDown } from "lucide-react";
import { processFifo } from "@pit38/tax-engine";
import type { Lot } from "@pit38/tax-engine";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import { formatPLN, formatQty, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

interface PositionRow {
  symbol: string;
  totalQty: Decimal;
  totalCost: Decimal;
  avgCostPerShare: Decimal;
  lots: Lot[];
}

function buildPositionRows(remainingLots: Lot[]): PositionRow[] {
  const map = new Map<string, PositionRow>();
  for (const lot of remainingLots) {
    if (lot.remainingQuantity.lte(0)) continue;
    let row = map.get(lot.symbol);
    if (!row) {
      row = { symbol: lot.symbol, totalQty: ZERO, totalCost: ZERO, avgCostPerShare: ZERO, lots: [] };
      map.set(lot.symbol, row);
    }
    const lotCost = lot.remainingQuantity.mul(lot.costPerSharePLN);
    row.totalQty = row.totalQty.add(lot.remainingQuantity);
    row.totalCost = row.totalCost.add(lotCost);
    row.lots.push(lot);
  }

  // Compute avgCostPerShare after accumulation
  for (const row of map.values()) {
    row.avgCostPerShare = row.totalQty.gt(0) ? row.totalCost.div(row.totalQty) : ZERO;
    // Sort lots oldest first
    row.lots.sort((a, b) => a.openDate.localeCompare(b.openDate));
  }

  return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function OpenPositionsPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const remainingLots = useMemo(() => {
    try {
      return processFifo(transactions).remainingLots;
    } catch {
      return [];
    }
  }, [transactions]);

  const positionRows = useMemo(() => buildPositionRows(remainingLots), [remainingLots]);

  const grandTotal = useMemo(
    () => positionRows.reduce((acc, r) => acc.add(r.totalCost), ZERO),
    [positionRows],
  );

  function toggle(symbol: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  if (transactions.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("tx_noData")}
      </p>
    );
  }

  if (positionRows.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("pos_noData")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table className="[&_td]:py-1.5 [&_th]:py-2 text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>{t("pos_colSymbol")}</TableHead>
              <TableHead className="text-right">{t("pos_colQty")}</TableHead>
              <TableHead className="text-right">{t("pos_colLots")}</TableHead>
              <TableHead className="text-right">{t("pos_colAvgCost")}</TableHead>
              <TableHead className="text-right">{t("pos_colTotalCost")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positionRows.map((row) => {
              const isExpanded = expanded.has(row.symbol);
              return (
                <>
                  {/* Symbol summary row */}
                  <TableRow
                    key={`pos-${row.symbol}`}
                    className="h-8 cursor-pointer hover:bg-accent/50"
                    onClick={() => toggle(row.symbol)}
                  >
                    <TableCell className="text-muted-foreground">
                      {isExpanded
                        ? <ChevronDown className="w-3 h-3" />
                        : <ChevronRight className="w-3 h-3" />}
                    </TableCell>
                    <TableCell className="font-mono font-semibold">{row.symbol}</TableCell>
                    <TableCell className="text-right font-mono">{formatQty(row.totalQty)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {row.lots.length}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(row.avgCostPerShare, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatPLN(row.totalCost)}
                    </TableCell>
                  </TableRow>

                  {/* Lot detail rows */}
                  {isExpanded && row.lots.map((lot, i) => {
                    const lotCost = lot.remainingQuantity.mul(lot.costPerSharePLN);
                    const isPartial = !lot.remainingQuantity.eq(lot.originalQuantity);
                    return (
                      <TableRow
                        key={`lot-${lot.id}-${i}`}
                        className="h-7 bg-muted/30 text-muted-foreground"
                      >
                        <TableCell />
                        <TableCell className="pl-6 font-mono text-[11px]">
                          {t("pos_colOpenDate")}: {lot.openDate}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px]">
                          {formatQty(lot.remainingQuantity)}
                          {isPartial && (
                            <span className="ml-1 text-muted-foreground/60">
                              / {formatQty(lot.originalQuantity)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right font-mono text-[11px]">
                          {formatNumber(lot.costPerSharePLN, 4)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px]">
                          {formatPLN(lotCost)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </>
              );
            })}

            {/* Grand total */}
            <TableRow className="h-8 border-t-2 font-semibold bg-muted/20">
              <TableCell />
              <TableCell>{positionRows.length} positions</TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell className="text-right font-mono">{formatPLN(grandTotal)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
