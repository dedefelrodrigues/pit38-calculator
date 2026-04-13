# CLAUDE.md

## Project

PIT-38 Polish capital gains tax calculator.
Browser-only React app — no backend, no database.
All calculation happens client-side.

## Architecture

- Monorepo managed with pnpm workspaces
- `packages/tax-engine` — pure TypeScript, zero framework dependencies
- `apps/web` — React + Vite + Tailwind + shadcn/ui

## Non-Negotiable Rules

- All monetary values use Decimal (never float or number for money)
- Tax engine has zero imports from React, Vite, or any UI framework
- Never modify test files to make tests pass — only fix implementation
- NBP rates use T-1 business day rule (previous business day before transaction)
- Tests must pass before moving to the next feature

## Key Commands

- Install: pnpm install
- Test tax engine: pnpm --filter tax-engine test
- Run web app: pnpm --filter web dev
- Build: pnpm --filter web build

## Test File Locations

- packages/tax-engine/tests/golden.test.ts ← never modify
- packages/tax-engine/tests/fifo.test.ts
- packages/tax-engine/tests/fx.test.ts
- packages/tax-engine/tests/parsers.test.ts
