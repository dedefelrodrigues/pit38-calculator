import { useState, useMemo } from "react";
import Decimal from "decimal.js";
import { ChevronRight, ChevronDown } from "lucide-react";
import { processFifo } from "@pit38/tax-engine";
import type { FifoMatch } from "@pit38/tax-engine";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import { formatPLN, formatQty, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

function holdingDays(buyDate: string, sellDate: string): number {
  return Math.round(
    (new Date(sellDate).getTime() - new Date(buyDate).getTime()) /
      (1000 * 60 * 60 * 24),
  );
}

function gainClass(d: Decimal) {
  if (d.gt(0)) return "text-emerald-600 dark:text-emerald-400";
  if (d.lt(0)) return "text-rose-600 dark:text-rose-400";
  return "";
}

// ---------------------------------------------------------------------------
// Per-symbol aggregated row
// ---------------------------------------------------------------------------

interface SymbolRow {
  symbol: string;
  totalQty: Decimal;
  totalRevenue: Decimal;
  totalCost: Decimal;
  totalGainLoss: Decimal;
  matches: FifoMatch[];
}

function buildSymbolRows(matches: FifoMatch[]): SymbolRow[] {
  const map = new Map<string, SymbolRow>();
  for (const m of matches) {
    let row = map.get(m.symbol);
    if (!row) {
      row = {
        symbol: m.symbol,
        totalQty: ZERO,
        totalRevenue: ZERO,
        totalCost: ZERO,
        totalGainLoss: ZERO,
        matches: [],
      };
      map.set(m.symbol, row);
    }
    row.matches.push(m);
    row.totalQty = row.totalQty.add(m.quantitySold);
    row.totalRevenue = row.totalRevenue.add(m.revenueGrossPLN);
    row.totalCost = row.totalCost.add(m.costBasisPLN).add(m.commissionSellPLN);
    row.totalGainLoss = row.totalGainLoss.add(m.gainLossPLN);
  }
  return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TaxLotsPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();

  const [yearFilter, setYearFilter] = useState("all");
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const [expandedSells, setExpandedSells] = useState<Set<string>>(new Set());

  // Run FIFO once — wrap in try/catch in case of data issues
  const fifoResult = useMemo(() => {
    try {
      return processFifo(transactions);
    } catch {
      return null;
    }
  }, [transactions]);

  const allMatches = fifoResult?.matches ?? [];

  const years = useMemo(
    () => [...new Set(allMatches.map((m) => m.sellDate.slice(0, 4)))].sort(),
    [allMatches],
  );

  const filtered = useMemo(
    () =>
      yearFilter === "all"
        ? allMatches
        : allMatches.filter((m) => m.sellDate.startsWith(yearFilter)),
    [allMatches, yearFilter],
  );

  const symbolRows = useMemo(() => buildSymbolRows(filtered), [filtered]);

  const totals = useMemo(
    () =>
      symbolRows.reduce(
        (acc, r) => ({
          revenue: acc.revenue.add(r.totalRevenue),
          cost: acc.cost.add(r.totalCost),
          gainLoss: acc.gainLoss.add(r.totalGainLoss),
        }),
        { revenue: ZERO, cost: ZERO, gainLoss: ZERO },
      ),
    [symbolRows],
  );

  function toggleSymbol(symbol: string) {
    setExpandedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
      return next;
    });
  }

  function toggleSell(sellTxId: string) {
    setExpandedSells((prev) => {
      const next = new Set(prev);
      if (next.has(sellTxId)) next.delete(sellTxId); else next.add(sellTxId);
      return next;
    });
  }

  if (allMatches.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("taxlots_noData")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Year filter */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">{t("taxlots_filterYear")}</Label>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("taxlots_yearAll")}</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground self-end pb-1">
          {filtered.length} sells · {symbolRows.length} symbols
        </span>
      </div>

      <div className="rounded-md border">
        <Table className="[&_td]:py-1.5 [&_th]:py-2 text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>{t("taxlots_colSymbol")}</TableHead>
              <TableHead className="text-right">{t("taxlots_colQtySold")}</TableHead>
              <TableHead className="text-right">{t("taxlots_colRevenue")}</TableHead>
              <TableHead className="text-right">{t("taxlots_colCost")}</TableHead>
              <TableHead className="text-right">{t("taxlots_colGainLoss")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {symbolRows.map((row) => {
              const symExpanded = expandedSymbols.has(row.symbol);
              return (
                <>
                  {/* Symbol summary row */}
                  <TableRow
                    key={`sym-${row.symbol}`}
                    className="h-8 cursor-pointer hover:bg-accent/50"
                    onClick={() => toggleSymbol(row.symbol)}
                  >
                    <TableCell className="text-muted-foreground">
                      {symExpanded
                        ? <ChevronDown className="w-3 h-3" />
                        : <ChevronRight className="w-3 h-3" />}
                    </TableCell>
                    <TableCell className="font-mono font-semibold">{row.symbol}</TableCell>
                    <TableCell className="text-right font-mono">{formatQty(row.totalQty)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPLN(row.totalRevenue)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPLN(row.totalCost)}</TableCell>
                    <TableCell className={cn("text-right font-mono font-medium", gainClass(row.totalGainLoss))}>
                      {formatPLN(row.totalGainLoss)}
                    </TableCell>
                  </TableRow>

                  {/* Individual sell rows */}
                  {symExpanded && row.matches.map((m) => {
                    const sellExpanded = expandedSells.has(m.sellTxId);
                    const cost = m.costBasisPLN.add(m.commissionSellPLN);
                    return (
                      <>
                        <TableRow
                          key={`sell-${m.sellTxId}`}
                          className="h-8 cursor-pointer bg-muted/30 hover:bg-accent/40"
                          onClick={() => toggleSell(m.sellTxId)}
                        >
                          <TableCell className="pl-6 text-muted-foreground">
                            {sellExpanded
                              ? <ChevronDown className="w-3 h-3" />
                              : <ChevronRight className="w-3 h-3" />}
                          </TableCell>
                          <TableCell className="font-mono text-muted-foreground pl-4">
                            {m.sellDate}
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatQty(m.quantitySold)}</TableCell>
                          <TableCell className="text-right font-mono">{formatPLN(m.revenueGrossPLN)}</TableCell>
                          <TableCell className="text-right font-mono">{formatPLN(cost)}</TableCell>
                          <TableCell className={cn("text-right font-mono", gainClass(m.gainLossPLN))}>
                            {formatPLN(m.gainLossPLN)}
                          </TableCell>
                        </TableRow>

                        {/* Lot breakdown */}
                        {sellExpanded && m.lots.map((lot, li) => {
                          const days = holdingDays(lot.lotOpenDate, m.sellDate);
                          return (
                            <TableRow
                              key={`lot-${m.sellTxId}-${li}`}
                              className="h-7 bg-muted/60 text-muted-foreground"
                            >
                              <TableCell />
                              <TableCell className="pl-10 font-mono text-[11px]">
                                ↳ {t("taxlots_colBuyDate")}: {lot.lotOpenDate}
                              </TableCell>
                              <TableCell className="text-right font-mono text-[11px]">
                                {formatQty(lot.quantityConsumed)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-[11px]" colSpan={1}>
                                {formatPLN(lot.costPLN)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-[11px]">
                                {formatNumber(lot.costPerSharePLN, 4)}/shr
                              </TableCell>
                              <TableCell className="text-right font-mono text-[11px]">
                                {days}d
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </>
                    );
                  })}
                </>
              );
            })}

            {/* Totals footer */}
            <TableRow className="h-8 border-t-2 font-semibold bg-muted/20">
              <TableCell />
              <TableCell>{t("taxlots_totals")}</TableCell>
              <TableCell />
              <TableCell className="text-right font-mono">{formatPLN(totals.revenue)}</TableCell>
              <TableCell className="text-right font-mono">{formatPLN(totals.cost)}</TableCell>
              <TableCell className={cn("text-right font-mono", gainClass(totals.gainLoss))}>
                {formatPLN(totals.gainLoss)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
