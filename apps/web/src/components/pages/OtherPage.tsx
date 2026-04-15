import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
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
import { formatPLN, formatNumber } from "@/lib/format";
import { getBrokerPalette } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { Transaction, TransactionType } from "@pit38/tax-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OTHER_TYPES: TransactionType[] = ["OTHER_INCOME", "FEE"];

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

type SortKey = "date" | "type" | "broker" | "source" | "currency";
type SortDir = "asc" | "desc";

function compareRows(a: Transaction, b: Transaction, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  if (key === "date")     cmp = a.date.localeCompare(b.date);
  if (key === "type")     cmp = a.type.localeCompare(b.type);
  if (key === "broker")   cmp = a.broker.localeCompare(b.broker);
  if (key === "source")   cmp = a.symbol.localeCompare(b.symbol);
  if (key === "currency") cmp = a.currency.localeCompare(b.currency);
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
        <Icon className={cn("w-3 h-3", active ? "text-foreground" : "text-muted-foreground/40")} />
      </span>
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function OtherPage() {
  const { t } = useI18n();
  const { transactions } = useTransactions();
  const { theme } = useTheme();
  const BROKER_PALETTE = getBrokerPalette(theme);

  const [typeFilter, setTypeFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
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

  const other = useMemo(
    () => transactions.filter((tx) => tx.type === "FEE" || tx.type === "OTHER_INCOME"),
    [transactions],
  );

  const brokers = useMemo(
    () => [...new Set(other.map((tx) => tx.broker))].sort(),
    [other],
  );

  const sources = useMemo(
    () => [...new Set(other.map((tx) => tx.symbol))].sort(),
    [other],
  );

  const brokerColor = useMemo(
    () => new Map(brokers.map((b, i) => [b, BROKER_PALETTE[i % BROKER_PALETTE.length]])),
    [brokers, BROKER_PALETTE],
  );

  const filtered = useMemo(
    () =>
      other
        .filter((tx) => {
          if (typeFilter !== "all" && tx.type !== typeFilter) return false;
          if (brokerFilter !== "all" && tx.broker !== brokerFilter) return false;
          if (sourceFilter !== "all" && tx.symbol !== sourceFilter) return false;
          if (dateFrom && tx.date < dateFrom) return false;
          if (dateTo && tx.date > dateTo) return false;
          return true;
        })
        .sort((a, b) => compareRows(a, b, sortKey, sortDir)),
    [other, typeFilter, brokerFilter, sourceFilter, dateFrom, dateTo, sortKey, sortDir],
  );

  if (other.length === 0) {
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
          <Label className="text-xs">{t("tx_filterType")}</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tx_filterAll")}</SelectItem>
              {OTHER_TYPES.map((type) => (
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
          <Label className="text-xs">{t("tx_colSource")}</Label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tx_filterAll")}</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
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
          {filtered.length} / {other.length}
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
                <SortHead label={t("tx_colBroker")}   sortKey="broker"   {...sortHeadProps} />
                <SortHead label={t("tx_colType")}     sortKey="type"     {...sortHeadProps} />
                <SortHead label={t("tx_colSource")}   sortKey="source"   {...sortHeadProps} />
                <TableHead>{t("tx_colDescription")}</TableHead>
                <SortHead label={t("tx_colCurrency")} sortKey="currency" {...sortHeadProps} />
                <TableHead className="text-right">{t("tx_colGross")}</TableHead>
                <TableHead className="text-right">{t("tx_colFxRate")}</TableHead>
                <TableHead className="text-right">{t("tx_colGrossPLN")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((tx) => (
                <TableRow key={tx.id} className="h-8">
                  <TableCell className="font-mono">{tx.date}</TableCell>
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
                  <TableCell><TypeBadge type={tx.type} /></TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {tx.symbol}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {tx.name ?? "—"}
                  </TableCell>
                  <TableCell>{tx.currency}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(tx.grossAmount, 2)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(tx.fxRate, 4)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatPLN(tx.grossAmountPLN)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
