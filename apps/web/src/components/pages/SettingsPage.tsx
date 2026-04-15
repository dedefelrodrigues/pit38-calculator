import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/contexts/I18nContext";
import { useSettings } from "@/contexts/SettingsContext";
import { cn } from "@/lib/utils";
import type { CalculateTaxOptions } from "@pit38/tax-engine";

// ---------------------------------------------------------------------------
// Toggle switch component
// ---------------------------------------------------------------------------

interface ToggleProps {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function SettingToggle({ label, description, value, onChange }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
          {description}
        </p>
      </div>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value
            ? "bg-primary border-primary"
            : "bg-muted border-muted",
        )}
      >
        <span
          className={cn(
            "block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform mt-0.5",
            value ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { t } = useI18n();
  const { options, setOption } = useSettings();

  function toggle(key: keyof CalculateTaxOptions) {
    setOption(key, !options[key]);
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("settings_title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings_subtitle")}
        </p>
      </div>

      {/* Dividend & income sources */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("settings_sectionSources")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <SettingToggle
            label={t("settings_includeDividendAccruals")}
            description={t("settings_includeDividendAccrualsDesc")}
            value={options.includeDividendAccruals ?? false}
            onChange={() => toggle("includeDividendAccruals")}
          />
          <Separator />
          <SettingToggle
            label={t("settings_includeCyep")}
            description={t("settings_includeCyepDesc")}
            value={options.includeCyep ?? false}
            onChange={() => toggle("includeCyep")}
          />
          <Separator />
          <SettingToggle
            label={t("settings_includeInterest")}
            description={t("settings_includeInterestDesc")}
            value={options.includeInterest ?? false}
            onChange={() => toggle("includeInterest")}
          />
          <Separator />
          <SettingToggle
            label={t("settings_includeOtherIncome")}
            description={t("settings_includeOtherIncomeDesc")}
            value={options.includeOtherIncome ?? false}
            onChange={() => toggle("includeOtherIncome")}
          />
        </CardContent>
      </Card>

      {/* Calculation rules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("settings_sectionCalc")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <SettingToggle
            label={t("settings_lossCarryForward")}
            description={t("settings_lossCarryForwardDesc")}
            value={options.lossCarryForward ?? false}
            onChange={() => toggle("lossCarryForward")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
