export type {
  Currency,
  TransactionType,
  RawTransaction,
  Transaction,
  Lot,
  FifoLotMatch,
  FifoMatch,
  DividendItem,
  EquitySummary,
  DividendSummary,
  OtherIncomeSummary,
  TaxSummary,
} from "./types.js";

export { processFifo } from "./fifo.js";
export type { FifoResult } from "./fifo.js";

export { parseNbpCsv, parseAndMergeNbpCsvs, lookupFxRate, enrichTransaction, enrichTransactions, detectMissingRates, mergeNbpRates } from "./fx.js";
export type { NbpTable, FxRateLookup, MissingRate } from "./fx.js";

export { fetchNbpRatesForDate, resolveAndFetchMissing } from "./nbp-api.js";

export { parseDegiroTrades, parseDegiroAccount, parseDegiroDate, splitCsvLine } from "./degiro.js";
