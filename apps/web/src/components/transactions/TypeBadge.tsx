import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/contexts/I18nContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { TransactionType } from "@pit38/tax-engine";

const TYPE_STYLE_LIGHT: Record<string, string> = {
  BUY:             "bg-blue-50    text-blue-700    border-blue-200",
  SELL:            "bg-orange-50  text-orange-700  border-orange-200",
  STOCK_SPLIT:     "bg-purple-50  text-purple-700  border-purple-200",
  DIVIDEND:        "bg-green-50   text-green-700   border-green-200",
  WITHHOLDING_TAX: "bg-red-50     text-red-700     border-red-200",
  FEE:             "bg-gray-50    text-gray-600    border-gray-200",
  OTHER_INCOME:    "bg-teal-50    text-teal-700    border-teal-200",
};

const TYPE_STYLE_DARK: Record<string, string> = {
  BUY:             "bg-blue-950/60    text-blue-300    border-blue-700",
  SELL:            "bg-orange-950/60  text-orange-300  border-orange-700",
  STOCK_SPLIT:     "bg-purple-950/60  text-purple-300  border-purple-700",
  DIVIDEND:        "bg-green-950/60   text-green-300   border-green-700",
  WITHHOLDING_TAX: "bg-red-950/60     text-red-300     border-red-700",
  FEE:             "bg-zinc-800/60    text-zinc-400    border-zinc-600",
  OTHER_INCOME:    "bg-teal-950/60    text-teal-300    border-teal-700",
};

interface Props {
  type: TransactionType;
}

export function TypeBadge({ type }: Props) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const styles = theme === "dark" ? TYPE_STYLE_DARK : TYPE_STYLE_LIGHT;
  const key = `type_${type}` as Parameters<typeof t>[0];
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium", styles[type] ?? "")}
    >
      {t(key)}
    </Badge>
  );
}
