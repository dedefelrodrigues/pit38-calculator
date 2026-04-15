import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import Decimal from "decimal.js";
import { computeRunningPositions } from "@pit38/tax-engine";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TypeBadge } from "@/components/transactions/TypeBadge";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import { useTheme } from "@/contexts/ThemeContext";
import { formatPLN, formatQty, formatNumber } from "@/lib/format";
import { getBrokerPalette } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { Transaction, TransactionType } from "@pit38/tax-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STOCK_TYPES: TransactionType[] = ["BUY", "SELL", "STOCK_SPLIT"];
const ZERO = new Decimal(0);

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

type SortKey = "date" | "symbol" | "type" | "currency" | "broker";
type SortDir = "asc" | "desc";

function compareRows(a: Transaction, b: Transaction, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  if (key === "date")     cmp = a.date.localeCompare(b.date);
  if (key === "symbol")   cmp = a.symbol.localeCompare(b.symbol);
  if (key === "type")     cmp = a.type.localeCompare(b.type);
  if (key === "currency") cmp = a.currency.localeCompare(b.currency);
  if (key === "broker")   cmp = a.broker.localeCompare(b.broker);
  // Secondary sort by date for stability
  if (cmp === 0 && key !== "date") cmp = a.date.localeCompare(b.date);
  return dir === "asc" ? cmp : -cmp;
}

// ---------------------------------------------------------------------------
// Sortable header cell
// ---------------------------------------------------------------------------

interface SortHeadProps {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
}

function SortHead({ label, sortKey, current, dir, onClick, className }: SortHeadProps) {
  const active = current === sortKey;
  const Icon = active ? (dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <TableHead
      className={cn("cursor-pointer select-none whitespace-nowrap", className)}
      onClick={() => onClick(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon
          className={cn("w-3 h-3", active ? "text-foreground" : "text-muted-foreground/40")}
        />
      </span>
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function StocksPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();
  const { theme } = useTheme();
  const BROKER_PALETTE = getBrokerPalette(theme);

  const [symbol, setSymbol] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // All stock-type transactions
  const stocks = useMemo(
    () => transactions.filter((tx) => STOCK_TYPES.includes(tx.type as TransactionType)),
    [transactions],
  );

  // Running position map — computed from all transactions (engine handles filtering)
  const positionMap = useMemo(() => computeRunningPositions(transactions), [transactions]);

  // Available broker options derived from data
  const brokers = useMemo(
    () => [...new Set(stocks.map((tx) => tx.broker))].sort(),
    [stocks],
  );

  // Stable color assignment: sorted order → palette index
  const brokerColor = useMemo(
    () => new Map(brokers.map((b, i) => [b, BROKER_PALETTE[i % BROKER_PALETTE.length]])),
    [brokers, BROKER_PALETTE],
  );

  // Filter then sort
  const filtered = useMemo(
    () =>
      stocks
        .filter((tx) => {
          if (symbol && !tx.symbol.toLowerCase().includes(symbol.toLowerCase()))
            return false;
          if (typeFilter !== "all" && tx.type !== typeFilter) return false;
          if (brokerFilter !== "all" && tx.broker !== brokerFilter) return false;
          if (dateFrom && tx.date < dateFrom) return false;
          if (dateTo && tx.date > dateTo) return false;
          return true;
        })
        .sort((a, b) => compareRows(a, b, sortKey, sortDir)),
    [stocks, symbol, typeFilter, brokerFilter, dateFrom, dateTo, sortKey, sortDir],
  );

  if (stocks.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("tx_noData")}
      </p>
    );
  }

  const sortHeadProps = { current: sortKey, dir: sortDir, onClick: handleSort };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">{t("tx_filterSymbol")}</Label>
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="AAPL…"
            className="h-7 w-28 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("tx_filterType")}</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tx_filterAll")}</SelectItem>
              {STOCK_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`type_${type}` as Parameters<typeof t>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("tx_filterBroker")}</Label>
          <Select value={brokerFilter} onValueChange={setBrokerFilter}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tx_filterAll")}</SelectItem>
              {brokers.map((b) => (
                <SelectItem key={b} value={b} className="capitalize">
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("tx_filterFrom")}</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("tx_filterTo")}</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <span className="text-xs text-muted-foreground self-end pb-1">
          {filtered.length} / {stocks.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t("tx_noResults")}</p>
      ) : (
        <div className="rounded-md border">
          <Table className="[&_td]:py-1.5 [&_th]:py-2 text-xs">
            <TableHeader>
              <TableRow>
                <SortHead label={t("tx_colDate")}     sortKey="date"     {...sortHeadProps} />
                <SortHead label={t("tx_colSymbol")}   sortKey="symbol"   {...sortHeadProps} />
                <SortHead label={t("tx_colType")}     sortKey="type"     {...sortHeadProps} />
                <TableHead className="text-right">{t("tx_colQty")}</TableHead>
                <TableHead className="text-right">{t("tx_colPrice")}</TableHead>
                <SortHead label={t("tx_colCurrency")} sortKey="currency" {...sortHeadProps} />
                <TableHead className="text-right">{t("tx_colGross")}</TableHead>
                <TableHead className="text-right">{t("tx_colCommOrig")}</TableHead>
                <TableHead className="text-right">{t("tx_colFxRate")}</TableHead>
                <TableHead className="text-right">{t("tx_colCommission")}</TableHead>
                <TableHead className="text-right">{t("tx_colValuePLN")}</TableHead>
                <SortHead label={t("tx_colBroker")}   sortKey="broker"   {...sortHeadProps} />
                <TableHead className="text-right">{t("tx_colPosition")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((tx) => {
                const position = positionMap.get(tx.id) ?? ZERO;
                const posZero = position.isZero();
                return (
                  <TableRow key={tx.id} className="h-8">
                    <TableCell className="font-mono">{tx.date}</TableCell>
                    <TableCell className="font-mono font-medium">{tx.symbol}</TableCell>
                    <TableCell><TypeBadge type={tx.type} /></TableCell>
                    <TableCell className="text-right font-mono">
                      {tx.quantity ? formatQty(tx.quantity) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {tx.pricePerShare ? formatNumber(tx.pricePerShare, 4) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tx.type === "STOCK_SPLIT" ? "—" : tx.currency}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {tx.type === "STOCK_SPLIT" ? "—" : formatNumber(tx.grossAmount, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {tx.type === "STOCK_SPLIT" ? "—" : tx.commission.isZero() ? "—" : formatNumber(tx.commission, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {tx.type === "STOCK_SPLIT" ? "—" : formatNumber(tx.fxRate, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {tx.type === "STOCK_SPLIT" ? "—" : tx.commissionPLN.isZero() ? "—" : formatPLN(tx.commissionPLN)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {tx.type === "STOCK_SPLIT" ? "—" : formatPLN(tx.grossAmountPLN)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                          brokerColor.get(tx.broker) ?? BROKER_PALETTE[0],
                        )}
                      >
                        {tx.broker}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono font-medium",
                        posZero ? "text-muted-foreground" : "",
                      )}
                    >
                      {formatQty(position)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
