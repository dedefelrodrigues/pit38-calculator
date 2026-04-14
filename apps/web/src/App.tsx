import { Header } from "@/components/layout/Header";
import { UploadPanel } from "@/components/upload/UploadPanel";
import { ResultsPanel } from "@/components/results/ResultsPanel";
import { useCalculation } from "@/hooks/useCalculation";

export default function App() {
  const { state, calculate, reset } = useCalculation();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        <UploadPanel state={state} onCalculate={calculate} onReset={reset} />
        {state.status === "done" && (
          <ResultsPanel results={state.results} />
        )}
      </main>
    </div>
  );
}
