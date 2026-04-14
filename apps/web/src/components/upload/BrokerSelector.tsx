import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Broker } from "@/hooks/useCalculation";

interface Props {
  value: Broker | null;
  onChange: (broker: Broker) => void;
  disabled?: boolean;
}

export function BrokerSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Broker</label>
      <Select
        value={value ?? ""}
        onValueChange={(v) => onChange(v as Broker)}
        disabled={disabled === true}
      >
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Wybierz brokera…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="degiro">DEGIRO</SelectItem>
          <SelectItem value="ibkr">Interactive Brokers</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
