import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { UploadSlotButton } from "@/components/upload/UploadSlotButton";
import { useI18n } from "@/contexts/I18nContext";

export function UploadPage() {
  const { t } = useI18n();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("upload_title")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("upload_subtitle")}</p>
      </div>

      {/* DEGIRO */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("upload_degiro")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UploadSlotButton
            slot="degiro-trades"
            label={t("upload_degiroTrades")}
            hint={t("upload_degiroTradesHint")}
          />
          <Separator />
          <UploadSlotButton
            slot="degiro-account"
            label={t("upload_degiroAccount")}
            hint={t("upload_degiroAccountHint")}
          />
        </CardContent>
      </Card>

      {/* IBKR */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("upload_ibkr")}</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadSlotButton
            slot="ibkr-stocks"
            label={t("upload_ibkrStocks")}
            hint={t("upload_ibkrStocksHint")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
