import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPLN } from "@/lib/format";
import type { TaxSummary } from "@pit38/tax-engine";

interface Props {
  year: number;
  summary: TaxSummary;
}

export function TaxSummaryBar({ year, summary }: Props) {
  return (
    <Card className="bg-primary text-primary-foreground">
      <CardContent className="py-4 flex flex-wrap items-center gap-x-8 gap-y-2">
        <div>
          <span className="text-sm opacity-75">Rok</span>
          <p className="text-2xl font-bold">{year}</p>
        </div>
        <div>
          <span className="text-sm opacity-75">Łączny podatek do zapłaty</span>
          <p className="text-2xl font-bold">
            {formatPLN(summary.totalTaxDue)}
          </p>
        </div>
        <div className="ml-auto flex gap-4 text-sm">
          <div className="text-right">
            <p className="opacity-75">Akcje / ETF</p>
            <p className="font-semibold">{formatPLN(summary.equity.taxDue)}</p>
          </div>
          <div className="text-right">
            <p className="opacity-75">Dywidendy</p>
            <p className="font-semibold">
              {formatPLN(summary.dividends.taxDue)}
            </p>
          </div>
          {summary.otherIncome.taxDue.gt(0) && (
            <div className="text-right">
              <p className="opacity-75">Inne dochody</p>
              <p className="font-semibold">
                {formatPLN(summary.otherIncome.taxDue)}
              </p>
            </div>
          )}
        </div>
        {summary.totalTaxDue.isZero() && (
          <Badge className="bg-primary-foreground text-primary">
            Brak podatku
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
