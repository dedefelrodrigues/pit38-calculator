import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Broker } from "@/hooks/useCalculation";

interface Props {
  broker: Broker;
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}

const BROKER_CONFIG: Record<
  Broker,
  { label: string; inputs: { key: string; hint: string }[] }
> = {
  degiro: {
    label: "DEGIRO — dwa pliki CSV",
    inputs: [
      { key: "trades", hint: "Transakcje (Transactions.csv)" },
      { key: "account", hint: "Wyciąg konta (Account.csv)" },
    ],
  },
  ibkr: {
    label: "IBKR — plik Activity Statement",
    inputs: [{ key: "activity", hint: "Activity Statement (.csv)" }],
  },
};

export function FileUpload({ broker, files, onFilesChange, disabled }: Props) {
  const config = BROKER_CONFIG[broker];
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function handleChange(index: number, picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const updated = [...files];
    updated[index] = picked[0]!;
    onFilesChange(updated);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{config.label}</p>
      {config.inputs.map((input, i) => (
        <div key={input.key} className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRefs.current[i]?.click()}
          >
            {files[i] ? "Zmień plik" : "Wybierz plik"}
          </Button>
          <input
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type="file"
            accept=".csv"
            className="hidden"
            disabled={disabled}
            onChange={(e) => handleChange(i, e.target.files)}
          />
          {files[i] ? (
            <Badge variant="secondary" className="font-mono text-xs">
              {files[i]!.name}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">{input.hint}</span>
          )}
        </div>
      ))}
    </div>
  );
}
