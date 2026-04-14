import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BrokerSelector } from "./BrokerSelector";
import { FileUpload } from "./FileUpload";
import type { Broker, CalcState, CalcStep } from "@/hooks/useCalculation";

interface Props {
  state: CalcState;
  onCalculate: (broker: Broker, files: File[]) => void;
  onReset: () => void;
}

const STEP_LABELS: Record<CalcStep, string> = {
  "loading-rates": "Ładowanie kursów NBP…",
  parsing: "Parsowanie pliku CSV…",
  "filling-gaps": "Pobieranie brakujących kursów z API NBP…",
  enriching: "Przeliczanie na PLN…",
  calculating: "Obliczanie podatku…",
};

const STEP_PROGRESS: Record<CalcStep, number> = {
  "loading-rates": 15,
  parsing: 35,
  "filling-gaps": 55,
  enriching: 75,
  calculating: 90,
};

export function UploadPanel({ state, onCalculate, onReset }: Props) {
  const [broker, setBroker] = useState<Broker | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  const isRunning = state.status === "running";
  const isDone = state.status === "done";
  const isError = state.status === "error";

  const requiredFileCount = broker === "degiro" ? 2 : broker === "ibkr" ? 1 : 0;
  const canCalculate =
    broker !== null &&
    files.filter(Boolean).length >= requiredFileCount &&
    !isRunning;

  function handleReset() {
    setBroker(null);
    setFiles([]);
    onReset();
  }

  if (isDone || isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isDone ? "Obliczenia zakończone" : "Błąd"}
          </CardTitle>
          {isDone && state.status === "done" && (
            <CardDescription>
              {state.transactionCount} transakcji
              {state.gapsFilled > 0
                ? `, ${state.gapsFilled} kurs(ów) pobranych z API NBP`
                : ""}
            </CardDescription>
          )}
          {isError && (
            <CardDescription className="text-destructive">
              {state.status === "error" && state.message}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={handleReset}>
            Wczytaj nowy plik
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wczytaj transakcje</CardTitle>
        <CardDescription>
          Wybierz brokera i wgraj plik eksportu CSV
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <BrokerSelector
          value={broker}
          onChange={(b) => {
            setBroker(b);
            setFiles([]);
          }}
          disabled={isRunning}
        />

        {broker && (
          <FileUpload
            broker={broker}
            files={files}
            onFilesChange={setFiles}
            disabled={isRunning}
          />
        )}

        {isRunning && state.status === "running" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {STEP_LABELS[state.step]}
            </p>
            <Progress value={STEP_PROGRESS[state.step]} className="h-1.5" />
          </div>
        )}

        <Button
          disabled={!canCalculate}
          onClick={() => broker && onCalculate(broker, files)}
        >
          Oblicz podatek
        </Button>
      </CardContent>
    </Card>
  );
}
