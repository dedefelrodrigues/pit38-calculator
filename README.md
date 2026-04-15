# PIT-38 Calculator

A browser-only tool for Polish taxpayers who invest through foreign brokers (DEGIRO, Interactive Brokers). It imports your broker CSV exports, converts all amounts to PLN using official NBP exchange rates, calculates your capital gains tax liability, and produces the numbers you need to fill in PIT-38 and its PIT-ZG annexes.

**Nothing leaves your browser.** All parsing, FX conversion, and tax calculation runs entirely client-side.

---

## Quick start

```bash
pnpm install
pnpm --filter web dev
```

Open `http://localhost:5173`.

---

## Supported brokers

| Broker | File to export |
|--------|---------------|
| DEGIRO | **Transactions** CSV (transaction overview) |
| DEGIRO | **Account Statement** CSV (needed for dividends and withholding tax) |
| Interactive Brokers | **Activity Statement** (flex query or full statement — covers trades, dividends, splits) |

You can upload files from multiple brokers simultaneously. Duplicate detection prevents double-counting when you re-upload the same file.

---

## How to use

### 1. Upload

Go to **Upload** and drop your CSV files into the appropriate slots. Each file is parsed immediately in the browser — no data is sent to a server.

After upload the app:
1. Parses the CSV into typed transactions (buy, sell, dividend, withholding tax, stock split, etc.)
2. Resolves any ISIN codes to ticker symbols via OpenFIGI
3. Looks up NBP Table A exchange rates using the **T-1 business day rule** (the last NBP rate published strictly before each transaction date)
4. If a rate is missing from the bundled files, fetches it live from the [NBP public API](https://api.nbp.pl/)
5. Enriches each transaction with PLN amounts

NBP rate files for 2020–2025 are bundled. The current year is fetched automatically from the NBP API when needed.

### 2. Review transactions

The **Transactions** section has four sub-pages:

- **Stocks & ETFs** — all buy and sell activity with per-trade FX rate and PLN value
- **Dividends** — dividend receipts matched with their withholding tax entries
- **Other** — fees, interest, and other income (IBKR-specific categories)
- **Corporate Actions** — stock splits with before/after position

### 3. Tax Lots

Shows FIFO lot matching for every sell. Drill into any sell to see which buy lots were consumed, how many shares from each lot, the cost per share, and how many days the position was held.

### 4. Open Positions

All lots that have not yet been sold, grouped by symbol. Useful for verifying cost basis for positions you still hold.

### 5. PIT Calculator

Year-by-year tax summary with three sections per year:

| Section | What it covers |
|---------|---------------|
| Equity — Stocks & ETFs | FIFO gain/loss, optional carry-forward deduction, 19% tax base |
| Dividends | Gross dividends, foreign WHT credit, net Polish tax due |
| Other Income | IBKR interest, CYEP, and other tagged items (if enabled in Settings) |

Below the summary cards are two reference tables:

**PIT-38 Form Reference** — the exact PLN amounts to enter into each form field (C.20 through C.24 for equity; Div rows for dividends).

**PIT-ZG Annex Reference** — per-country breakdown required when you have foreign-source income. Country is derived from the ISIN prefix. One PIT-ZG annex must be filed for each non-PL country. Columns map to Part C.3 of the PIT-ZG form:
- Przychód (revenue)
- Koszty uzyskania (costs)
- Dochód / Strata (net gain or loss)
- Dywidendy brutto (gross dividends)
- Podatek zapłacony za granicą (foreign WHT paid)

Polish securities (ISIN prefix `PL`) are excluded from PIT-ZG since they are domestic income.

### 6. Loss Carry-Forward

Controls how prior-year equity losses are applied to future gains under Art. 9 ust. 3 ustawy o PIT (5-year window, max 50% of original loss per deduction year, oldest losses applied first).

**Automatic mode** — losses detected in the uploaded data are carried forward automatically.

**Manual mode** — enter additional prior-year losses from years before your uploaded data (e.g. losses from 2018 that you want to carry into 2020+). These stack with any auto-detected losses. Useful when your uploaded history doesn't cover all loss years.

The page shows a year-by-year preview table: equity gain/loss, carry deduction applied, adjusted tax base, and resulting 19% tax.

### 7. Issues

Data quality checks run automatically after every upload. Issues are grouped by severity:

| Severity | Examples |
|----------|---------|
| **Error** | SELL with no matching buy lots (missing history); zero FX rate; negative running position |
| **Warning** | Orphaned withholding tax; stock split with no open position; duplicate transaction IDs; future-dated transactions; large FX rate delta |
| **Info** | Unresolved ISINs; NBP rate gap > 5 business days; same symbol appearing in multiple currencies |

Errors indicate data that will produce incorrect tax numbers. Warnings and info items are worth reviewing but may be benign.

### 8. Settings

Controls what is included in the PIT-38 calculation:

| Toggle | Default | What it does |
|--------|---------|-------------|
| Dividend accruals | On | Include IBKR "Change in Dividend Accruals" net amounts |
| CYEP / Broker fees | On | Include IBKR CYEP income and broker fee charges |
| Interest | On | Include IBKR credit/debit interest |
| Other income & fees | Off | Include unclassified FEE and OTHER_INCOME transactions |
| Loss carry-forward | Off | Enable automatic carry-forward of equity losses (also configurable on the Loss Carry-Forward page) |

---

## NBP exchange rates

The T-1 rule: each transaction is converted using the NBP Table A rate published on the last business day **before** the transaction date.

Bundled CSV files cover 2020–2025 (`public/nbp_rates/archiwum_tab_a_YYYY.csv`). For the current year and any gaps:
- The app automatically tries to load the current year's file at startup
- Any remaining missing dates are fetched live from `https://api.nbp.pl/`

To update bundled rates manually, download the annual archive from [nbp.pl/en/statistic-and-financial-reporting/rates/](https://www.nbp.pl/en/statistic-and-financial-reporting/rates/) and place the file in `apps/web/public/nbp_rates/` and `reference/nbp_rates/` using the same naming convention.

---

## Polish tax law context

- **PIT-38** — annual return for capital gains from securities (akcje, ETF, obligacje)
- **Tax rate** — 19% flat on equity gains and dividend income
- **Dividends** — gross amount × 19%; foreign WHT is credited up to the full Polish tax (cannot create a refund)
- **Loss carry-forward** — equity losses can offset equity gains for up to 5 subsequent years, with a cap of 50% of the original loss per year (Art. 9 ust. 3 ustawy o PIT)
- **PIT-ZG** — mandatory annex for each foreign country where income was earned; filed together with PIT-38

> **This tool is an aid for self-calculation, not professional tax advice. Verify results against the official PIT-38 form and consult a tax advisor for complex situations.**

---

## Development

```bash
# Install dependencies
pnpm install

# Run the web app (hot reload)
pnpm --filter web dev

# Run tax engine tests
pnpm --filter tax-engine test

# Production build
pnpm --filter web build
```

### Project structure

```
pit38-calculator/
├── apps/
│   └── web/                  # React + Vite + Tailwind + shadcn/ui
│       ├── public/
│       │   └── nbp_rates/    # Bundled NBP Table A CSVs (2020–2025)
│       └── src/
│           ├── components/   # Pages and UI components
│           ├── contexts/     # React contexts (transactions, settings, carry-forward)
│           └── lib/          # Utilities (i18n, formatting, dedup)
├── packages/
│   └── tax-engine/           # Pure TypeScript — zero framework dependencies
│       ├── src/
│       │   ├── types.ts      # Core data types
│       │   ├── fifo.ts       # FIFO lot matching
│       │   ├── fx.ts         # NBP rate lookup and FX enrichment
│       │   ├── calculate.ts  # Tax orchestration (equity, dividends, other)
│       │   ├── degiro.ts     # DEGIRO CSV parser
│       │   ├── ibkr.ts       # IBKR activity statement parser
│       │   └── nbp-api.ts    # Live NBP API fetcher
│       └── tests/
└── reference/                # Reference files and known issues log
    ├── nbp_rates/            # Source NBP CSVs (same files as public/)
    ├── todo_list.txt         # Feature backlog
    └── known_issues.txt      # Bugs pending investigation
```
