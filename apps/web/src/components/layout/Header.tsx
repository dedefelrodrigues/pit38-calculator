import { Badge } from "@/components/ui/badge";

export function Header() {
  const currentYear = new Date().getFullYear();

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            PIT-38 Kalkulator
          </h1>
          <p className="text-sm text-muted-foreground">
            Podatek od zysków kapitałowych
          </p>
        </div>
        <Badge variant="secondary" className="ml-auto">
          {currentYear}
        </Badge>
      </div>
    </header>
  );
}
