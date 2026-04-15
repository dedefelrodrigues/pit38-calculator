import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/contexts/I18nContext";
import type { Page } from "@/App";
import type { StringKey } from "@/lib/i18n";

interface NavEntry {
  type: "item" | "section" | "separator";
  id?: Page;
  labelKey?: StringKey;
  disabled?: boolean;
  indent?: boolean;
}

const NAV: NavEntry[] = [
  { type: "item",      id: "upload",        labelKey: "nav_upload" },
  { type: "separator" },
  { type: "section",                        labelKey: "nav_transactions" },
  { type: "item",      id: "tx-stocks",            labelKey: "nav_txStocks",           indent: true },
  { type: "item",      id: "tx-dividends",         labelKey: "nav_txDividends",        indent: true },
  { type: "item",      id: "tx-other",             labelKey: "nav_txOther",            indent: true },
  { type: "item",      id: "tx-corporate-actions", labelKey: "nav_txCorporateActions", indent: true },
  { type: "separator" },
  { type: "item",      id: "taxLots",       labelKey: "nav_taxLots" },
  { type: "item",      id: "openPositions", labelKey: "nav_openPositions" },
  { type: "item",      id: "pitCalculator",   labelKey: "nav_pitCalculator" },
  { type: "item",      id: "lossCarryForward", labelKey: "nav_lossCarryForward" },
  { type: "item",      id: "issues",          labelKey: "nav_issues" },
  { type: "separator" },
  { type: "item",      id: "settings",      labelKey: "nav_settings" },
];

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

export function Sidebar({ currentPage, onNavigate }: Props) {
  const { t } = useI18n();

  return (
    <aside className="w-48 shrink-0 border-r bg-background flex flex-col min-h-screen">
      {/* App name */}
      <div className="px-4 py-4">
        <span className="font-bold text-sm tracking-tight">PIT-38</span>
        <span className="ml-1 text-muted-foreground text-xs font-normal">Calculator</span>
      </div>

      <Separator />

      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {NAV.map((entry, i) => {
          if (entry.type === "separator") {
            return <Separator key={i} className="my-1.5" />;
          }

          if (entry.type === "section") {
            return (
              <p
                key={i}
                className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {entry.labelKey ? t(entry.labelKey) : ""}
              </p>
            );
          }

          // item
          const active = currentPage === entry.id;
          return (
            <button
              key={entry.id}
              disabled={entry.disabled}
              onClick={() => entry.id && !entry.disabled && onNavigate(entry.id)}
              className={cn(
                "w-full text-left rounded-md text-sm transition-colors",
                entry.indent ? "pl-5 pr-3 py-1.5" : "px-3 py-1.5",
                entry.disabled
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : "hover:bg-accent hover:text-accent-foreground cursor-pointer",
                active && !entry.disabled ? "bg-accent font-medium" : "",
              )}
            >
              {entry.labelKey ? t(entry.labelKey) : ""}
              {entry.disabled && (
                <span className="ml-1.5 text-[9px] text-muted-foreground/40">
                  {t("nav_comingSoon")}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
