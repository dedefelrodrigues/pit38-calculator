import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPLN } from "@/lib/format";
import type { TaxSummary } from "@pit38/tax-engine";
import Decimal from "decimal.js";

interface Props {
  summary: TaxSummary;
}

export function PIT38FormMap({ summary }: Props) {
  const { equity, dividends } = summary;

  // PIT-38 fields (equity section C, dividend section D)
  const rows = [
    {
      line: "C.20",
      description: "Przychody z odpłatnego zbycia papierów wartościowych",
      value: equity.totalRevenuePLN,
    },
    {
      line: "C.21",
      description: "Koszty uzyskania przychodów (zakup + prowizje sprzedaży)",
      value: equity.totalCostPLN,
    },
    {
      line: "C.22",
      description: "Dochód / Strata z akcji",
      value: equity.totalGainLossPLN,
    },
    {
      line: "C.23 / podstawa",
      description: "Podstawa opodatkowania (max 0, strata = 0)",
      value: equity.taxBase,
    },
    {
      line: "C.24",
      description: "Zryczałtowany podatek 19% z akcji",
      value: equity.taxDue,
    },
    {
      line: "D.27",
      description: "Dywidendy brutto (przychód)",
      value: dividends.grossDividendsPLN,
    },
    {
      line: "D.28",
      description: "Podatek od dywidend 19%",
      value: dividends.polishTaxGross,
    },
    {
      line: "D.29",
      description: "Podatek zapłacony za granicą (zaliczka)",
      value: dividends.taxCredit,
    },
    {
      line: "D.30",
      description: "Podatek od dywidend do zapłaty w Polsce",
      value: dividends.taxDue,
    },
  ].filter((r) => r.value.abs().gt(new Decimal("0.001")));

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="font-medium text-sm">Mapowanie na formularz PIT-38</h3>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Pole PIT-38</TableHead>
              <TableHead>Opis</TableHead>
              <TableHead className="text-right">Kwota (PLN)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.line}>
                <TableCell className="font-mono font-medium">{r.line}</TableCell>
                <TableCell className="text-sm">{r.description}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatPLN(r.value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
