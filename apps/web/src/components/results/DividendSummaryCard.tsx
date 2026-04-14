import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPLN } from "@/lib/format";
import type { DividendSummary } from "@pit38/tax-engine";

interface Props {
  summary: DividendSummary;
}

export function DividendSummaryCard({ summary }: Props) {
  if (summary.items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Dywidendy</h3>
        <div className="flex gap-3 text-sm">
          <span className="text-muted-foreground">
            Podatek (19%):{" "}
            <span className="font-semibold text-foreground">
              {formatPLN(summary.polishTaxGross)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Zaliczony podatek zagraniczny:{" "}
            <span className="font-semibold text-foreground">
              − {formatPLN(summary.taxCredit)}
            </span>
          </span>
          <span className="text-muted-foreground">
            Do zapłaty:{" "}
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
              <TableHead>Data</TableHead>
              <TableHead>Waluta</TableHead>
              <TableHead className="text-right">Dywidenda (PLN)</TableHead>
              <TableHead className="text-right">Potrącony podatek (PLN)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.items.map((item) => (
              <TableRow key={item.txId}>
                <TableCell className="font-mono font-medium">
                  {item.symbol}
                </TableCell>
                <TableCell>{item.date}</TableCell>
                <TableCell>{item.currency}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatPLN(item.grossAmountPLN)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPLN(item.withholdingTaxPLN)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Card className="bg-muted/50">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-medium">Podsumowanie dywidend</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Dywidendy brutto</dt>
              <dd className="font-mono font-medium">
                {formatPLN(summary.grossDividendsPLN)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">PL podatek 19%</dt>
              <dd className="font-mono font-medium">
                {formatPLN(summary.polishTaxGross)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Zagraniczna zaliczka</dt>
              <dd className="font-mono font-medium">
                − {formatPLN(summary.taxCredit)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground font-semibold">
                Podatek do zapłaty
              </dt>
              <dd className="font-mono font-semibold">
                {formatPLN(summary.taxDue)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
