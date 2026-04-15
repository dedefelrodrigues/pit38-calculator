import { useState } from "react";
import { I18nProvider } from "@/contexts/I18nContext";
import { TransactionProvider } from "@/contexts/TransactionContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LossCarryForwardProvider } from "@/contexts/LossCarryForwardContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { UploadPage } from "@/components/pages/UploadPage";
import { StocksPage } from "@/components/pages/StocksPage";
import { DividendsPage } from "@/components/pages/DividendsPage";
import { OtherPage } from "@/components/pages/OtherPage";
import { CorporateActionsPage } from "@/components/pages/CorporateActionsPage";
import { TaxLotsPage } from "@/components/pages/TaxLotsPage";
import { OpenPositionsPage } from "@/components/pages/OpenPositionsPage";
import { PitCalculatorPage } from "@/components/pages/PitCalculatorPage";
import { LossCarryForwardPage } from "@/components/pages/LossCarryForwardPage";
import { IssuesPage } from "@/components/pages/IssuesPage";
import { SettingsPage } from "@/components/pages/SettingsPage";

export type Page =
  | "upload"
  | "tx-stocks"
  | "tx-dividends"
  | "tx-other"
  | "tx-corporate-actions"
  | "taxLots"
  | "openPositions"
  | "pitCalculator"
  | "lossCarryForward"
  | "issues"
  | "settings";

function AppShell() {
  const [page, setPage] = useState<Page>("upload");

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar currentPage={page} onNavigate={setPage} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar currentPage={page} />
        <main className="flex-1 p-6 overflow-auto">
          {page === "upload"                && <UploadPage />}
          {page === "tx-stocks"             && <StocksPage />}
          {page === "tx-dividends"          && <DividendsPage />}
          {page === "tx-other"              && <OtherPage />}
          {page === "tx-corporate-actions"  && <CorporateActionsPage />}
          {page === "taxLots"               && <TaxLotsPage />}
          {page === "openPositions"         && <OpenPositionsPage />}
          {page === "pitCalculator"         && <PitCalculatorPage />}
          {page === "lossCarryForward"      && <LossCarryForwardPage />}
          {page === "issues"                && <IssuesPage />}
          {page === "settings"              && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <SettingsProvider>
          <LossCarryForwardProvider>
            <TransactionProvider>
              <AppShell />
            </TransactionProvider>
          </LossCarryForwardProvider>
        </SettingsProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
