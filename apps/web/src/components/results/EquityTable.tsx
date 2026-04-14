import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatPLN, formatQty } from "@/lib/format";
import type { EquitySummary } from "@pit38/tax-engine";

interface Props {
  summary: EquitySummary;
}

export function EquityTable({ summary }: Props) {
  if (summary.matches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        Brak transakcji sprzedaży w tym roku.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Akcje i ETF</h3>
        <div className="flex gap-3 text-sm">
          <span className="text-muted-foreground">
            Podstawa opodatkowania:{" "}
            <span className="font-semibold text-foreground">
              {formatPLN(summary.taxBase)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Podatek (19%):{" "}
            <span className="font-semibold text-foreground">
              {formatPLN(summary.taxDue)}
            </span>
          </span>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Data sprzedaży</TableHead>
              <TableHead className="text-right">Ilość</TableHead>
              <TableHead className="text-right">Przychód (PLN)</TableHead>
              <TableHead className="text-right">Koszty (PLN)</TableHead>
              <TableHead className="text-right">Zysk/Strata (PLN)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.matches.map((m) => {
              const cost = m.costBasisPLN.add(m.commissionSellPLN);
              const isGain = m.gainLossPLN.gte(0);
              return (
                <TableRow key={m.sellTxId}>
                  <TableCell className="font-mono font-medium">
                    {m.symbol}
                  </TableCell>
                  <TableCell>{m.sellDate}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatQty(m.quantitySold)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatPLN(m.revenueGrossPLN)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatPLN(cost)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span
                      className={
                        isGain ? "text-green-700" : "text-destructive"
                      }
                    >
                      {formatPLN(m.gainLossPLN)}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
                Łącznie
              </TableCell>
              <TableCell className="text-right font-mono font-semibold">
                {formatPLN(summary.totalRevenuePLN)}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold">
                {formatPLN(summary.totalCostPLN)}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold">
                <span
                  className={
                    summary.totalGainLossPLN.gte(0)
                      ? "text-green-700"
                      : "text-destructive"
                  }
                >
                  {formatPLN(summary.totalGainLossPLN)}
                </span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {summary.totalGainLossPLN.lt(0) && (
        <p className="text-sm text-muted-foreground">
          Strata: podstawa opodatkowania wynosi 0 zł (PIT-38 nie pozwala na
          przeniesienie straty na kolejne lata).
        </p>
      )}
    </div>
  );
}
