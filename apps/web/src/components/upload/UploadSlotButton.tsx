import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";
import type { UploadSlot } from "@/contexts/TransactionContext";

interface Props {
  slot: UploadSlot;
  label: string;
  hint: string;
}

export function UploadSlotButton({ slot, label, hint }: Props) {
  const { t } = useI18n();
  const { slotState, uploadFile } = useTransactions();
  const inputRef = useRef<HTMLInputElement>(null);
  const { fileName, status } = slotState[slot];
  const isLoading = status.state === "loading";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={() => inputRef.current?.click()}
        >
          {fileName ? t("upload_changeFile") : t("upload_chooseFile")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(slot, file);
            // Reset so same file can be re-uploaded
            e.target.value = "";
          }}
        />
        <span className="text-sm font-medium">{label}</span>
      </div>

      {/* Status line */}
      {status.state === "idle" && (
        <p className="text-xs text-muted-foreground pl-1">{hint}</p>
      )}
      {status.state === "loading" && (
        <p className="text-xs text-muted-foreground pl-1 animate-pulse">
          {t("upload_loadingRates")}
        </p>
      )}
      {status.state === "done" && (
        <p className="text-xs text-muted-foreground pl-1">
          <span className="text-green-700 font-medium">{fileName}</span>
          {" — "}
          <span className="font-medium">{status.added}</span>{" "}
          {t("upload_processed")}
          {status.duplicatesSkipped > 0 && (
            <span className="text-muted-foreground">
              {", "}
              {status.duplicatesSkipped} {t("upload_duplicate")}
            </span>
          )}
        </p>
      )}
      {status.state === "error" && (
        <p className="text-xs text-destructive pl-1">
          {t("upload_error")}: {status.message}
        </p>
      )}
    </div>
  );
}
