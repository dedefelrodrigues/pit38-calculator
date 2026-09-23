import { useMemo, useRef } from "react";
import { summarizeNbpCoverage } from "@pit38/tax-engine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/contexts/I18nContext";
import { useTransactions } from "@/contexts/TransactionContext";

export function NbpRatesUploadCard() {
  const { t } = useI18n();
  const { nbpTable, customNbpFiles, nbpUploadStatus, uploadNbpRateFiles, removeNbpRateFile } =
    useTransactions();
  const inputRef = useRef<HTMLInputElement>(null);
  const isLoading = nbpUploadStatus.state === "loading";

  const coverage = useMemo(
    () => (nbpTable ? summarizeNbpCoverage(nbpTable) : []),
    [nbpTable],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={() => inputRef.current?.click()}
        >
          {t("nbpRates_chooseFiles")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) uploadNbpRateFiles(files);
            // Reset so the same file set can be re-selected later
            e.target.value = "";
          }}
        />
        <span className="text-xs text-muted-foreground">{t("nbpRates_hint")}</span>
      </div>

      {isLoading && (
        <p className="text-xs text-muted-foreground pl-1 animate-pulse">
          {t("upload_loadingRates")}
        </p>
      )}

      {nbpUploadStatus.state === "done" &&
        (nbpUploadStatus.addedFiles > 0 || nbpUploadStatus.failedFiles.length > 0) && (
          <p className="text-xs pl-1">
            {nbpUploadStatus.addedFiles > 0 && (
              <span className="text-green-700 font-medium">
                {nbpUploadStatus.addedFiles} {t("nbpRates_filesAdded")}
              </span>
            )}
            {nbpUploadStatus.failedFiles.length > 0 && (
              <span className="text-destructive">
                {nbpUploadStatus.addedFiles > 0 ? " — " : ""}
                {nbpUploadStatus.failedFiles.map((f) => f.fileName).join(", ")}{" "}
                {t("nbpRates_filesFailed")}
              </span>
            )}
          </p>
        )}

      {customNbpFiles.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("nbpRates_uploadedFiles")}
          </p>
          <ul className="flex flex-col gap-1">
            {customNbpFiles.map((f) => (
              <li key={f.fileName} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{f.fileName}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-muted-foreground hover:text-destructive"
                  onClick={() => removeNbpRateFile(f.fileName)}
                >
                  {t("nbpRates_remove")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {coverage.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t("nbpRates_coverage")}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8">{t("nbpRates_year")}</TableHead>
                <TableHead className="h-8">{t("nbpRates_status")}</TableHead>
                <TableHead className="h-8 text-right">{t("nbpRates_rateCount")}</TableHead>
                <TableHead className="h-8">{t("nbpRates_range")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coverage.map((c) => (
                <TableRow key={c.year}>
                  <TableCell className="py-1.5 font-medium">{c.year}</TableCell>
                  <TableCell className="py-1.5">
                    {c.isCurrentYear ? (
                      <Badge variant="outline" className="text-blue-700 border-blue-300">
                        {t("nbpRates_inProgress")}
                      </Badge>
                    ) : c.isComplete ? (
                      <Badge variant="secondary" className="text-green-700">
                        {t("nbpRates_complete")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-amber-700">
                        {t("nbpRates_partial")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5 text-right">{c.count}</TableCell>
                  <TableCell className="py-1.5 text-muted-foreground">
                    {c.firstDate} → {c.lastDate}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
