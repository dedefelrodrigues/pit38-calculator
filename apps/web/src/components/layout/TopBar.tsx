import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { StringKey } from "@/lib/i18n";

const PAGE_TITLE_KEY: Record<string, StringKey> = {
  upload: "nav_upload",
  "tx-stocks": "nav_txStocks",
  "tx-dividends": "nav_txDividends",
  "tx-other": "nav_txOther",
  "tx-corporate-actions": "nav_txCorporateActions",
  openPositions: "nav_openPositions",
  pitCalculator: "nav_pitCalculator",
  settings: "nav_settings",
};

interface Props {
  currentPage: string;
}

export function TopBar({ currentPage }: Props) {
  const { lang, setLang, t } = useI18n();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-12 border-b bg-background flex items-center px-6 gap-4 shrink-0">
      <span className="text-sm font-medium flex-1">
        {t(PAGE_TITLE_KEY[currentPage] ?? "nav_upload")}
      </span>
      {/* Theme toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 px-0"
        onClick={toggleTheme}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <Sun className="w-3.5 h-3.5" />
        ) : (
          <Moon className="w-3.5 h-3.5" />
        )}
      </Button>

      {/* Language toggle */}
      <div className="flex gap-1">
        <Button
          variant={lang === "en" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setLang("en")}
        >
          EN
        </Button>
        <Button
          variant={lang === "pl" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setLang("pl")}
        >
          PL
        </Button>
      </div>
    </header>
  );
}
