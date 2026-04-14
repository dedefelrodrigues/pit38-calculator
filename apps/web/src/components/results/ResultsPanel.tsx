import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaxSummaryBar } from "./TaxSummaryBar";
import { EquityTable } from "./EquityTable";
import { DividendSummaryCard } from "./DividendSummaryCard";
import { PIT38FormMap } from "./PIT38FormMap";
import type { TaxSummary } from "@pit38/tax-engine";

interface Props {
  results: Map<number, TaxSummary>;
}

export function ResultsPanel({ results }: Props) {
  const years = [...results.keys()].sort((a, b) => b - a); // most recent first

  if (years.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Brak lat z aktywnością podatkową.
      </p>
    );
  }

  return (
    <Tabs defaultValue={String(years[0])}>
      <TabsList>
        {years.map((y) => (
          <TabsTrigger key={y} value={String(y)}>
            {y}
          </TabsTrigger>
        ))}
      </TabsList>

      {years.map((year) => {
        const summary = results.get(year)!;
        return (
          <TabsContent key={year} value={String(year)} className="space-y-6 mt-4">
            <TaxSummaryBar year={year} summary={summary} />
            <EquityTable summary={summary.equity} />
            <DividendSummaryCard summary={summary.dividends} />
            <PIT38FormMap summary={summary} />
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
