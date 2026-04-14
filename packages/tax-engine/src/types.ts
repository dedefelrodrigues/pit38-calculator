import type { Decimal } from "decimal.js";

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

export type Currency =
  | "PLN"
  | "USD"
  | "EUR"
  | "GBP"
  | "CHF"
  | "CAD"
  | "AUD"
  | "HKD"
  | "NZD"
  | "SGD"
  | "JPY"
  | "HUF"
  | "CZK"
  | "DKK"
  | "NOK"
  | "SEK"
  | "RON"
  | "BGN"
  | "TRY"
  | "ILS"
  | "CNY"
  | "BRL"
  | "ZAR"
  | "MXN"
  | "MYR"
  | (string & {}); // open union — allows any ISO code without losing autocomplete

// ---------------------------------------------------------------------------
// Transaction types
// ---------------------------------------------------------------------------

export type TransactionType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "WITHHOLDING_TAX" // tax withheld at source on dividends/interest
  | "FEE" // standalone account or custody fees (not per-trade commissions)
  | "OTHER_INCOME" // interest, FX gains, corporate actions, etc.
  | "STOCK_SPLIT"; // Non-taxable corporate action. quantity = new shares per old share (e.g. 10 for 10:1, 0.1 for 1:10 reverse).

// ---------------------------------------------------------------------------
// RawTransaction — parser output, no PLN values yet
// ---------------------------------------------------------------------------

/**
 * Produced by each broker parser. All monetary amounts are in the original
 * trade currency. The FX enrichment step converts them to PLN and produces
 * a `Transaction`.
 */
export interface RawTransaction {
  /** Broker-assigned order/reference ID, or a generated UUID if absent. */
  id: string;

  /** Identifies the parser that produced this record, e.g. "degiro" | "ibkr". */
  broker: string;

  /** ISO date of the transaction: "YYYY-MM-DD". */
  date: string;

  type: TransactionType;

  // ---- Asset identification ------------------------------------------------

  /** Primary ticker symbol (e.g. "SAP", "BA", "CDPROJKT"). */
  symbol: string;

  /** ISIN when available (e.g. "DE0007164600"). */
  isin?: string;

  /** Human-readable product / company name. */
  name?: string;

  /**
   * Asset class reported by the broker.
   * Common values: "Stocks", "ETF", "Bonds", "Options", "Funds".
   */
  assetCategory?: string;

  // ---- Quantities (BUY / SELL only) ----------------------------------------

  /** Number of shares / units. Always positive. */
  quantity?: Decimal;

  /** Execution price per share in `currency`. Always positive. */
  pricePerShare?: Decimal;

  // ---- Monetary amounts (all in `currency`) ---------------------------------

  /** Original transaction currency. */
  currency: Currency;

  /**
   * Pre-commission amount.
   * - BUY:  quantity × pricePerShare
   * - SELL: quantity × pricePerShare (positive)
   * - DIVIDEND / OTHER_INCOME: gross income amount (positive)
   * - WITHHOLDING_TAX / FEE: the deducted amount (positive — sign is implied by type)
   */
  grossAmount: Decimal;

  /**
   * Broker commission for this trade. Always >= 0.
   * Standalone fees use the FEE transaction type instead.
   */
  commission: Decimal;

  /**
   * Net amount after commission.
   * - BUY:  grossAmount + commission  (total cash outflow)
   * - SELL: grossAmount − commission  (net proceeds)
   * - DIVIDEND: grossAmount (commission is typically 0)
   */
  netAmount: Decimal;
}

// ---------------------------------------------------------------------------
// Transaction — after FX enrichment, PLN values present
// ---------------------------------------------------------------------------

/**
 * A `RawTransaction` enriched with NBP T-1 exchange rate data.
 * All monetary fields are available in both original currency and PLN.
 *
 * When `currency === "PLN"`: fxRate = 1, fxDate = date, PLN fields equal originals.
 */
export interface Transaction extends RawTransaction {
  /**
   * PLN per 1 unit of `currency`, taken from the NBP Table A published on
   * the last business day before the transaction date (T-1 rule).
   */
  fxRate: Decimal;

  /**
   * The NBP table date from which `fxRate` was sourced: "YYYY-MM-DD".
   * Always <= date (may be several days earlier across weekends / holidays).
   */
  fxDate: string;

  /** grossAmount × fxRate */
  grossAmountPLN: Decimal;

  /** commission × fxRate */
  commissionPLN: Decimal;

  /** netAmount × fxRate */
  netAmountPLN: Decimal;
}

// ---------------------------------------------------------------------------
// Lot — open position entry for FIFO tracking
// ---------------------------------------------------------------------------

/**
 * Represents one purchase lot. `remainingQuantity` is decremented each time
 * a matching SELL consumes shares from this lot.
 *
 * Commission is pro-rated into `costPerSharePLN` so that partial sells
 * automatically receive the correct proportional cost:
 *   costPerSharePLN = (grossAmount + commission) × fxRate / originalQuantity
 */
export interface Lot {
  id: string; // typically the sourceTxId
  symbol: string;

  /** "YYYY-MM-DD" of the originating BUY. */
  openDate: string;

  /** Total shares purchased in this lot. */
  originalQuantity: Decimal;

  /** Shares not yet matched to a SELL. Starts equal to originalQuantity. */
  remainingQuantity: Decimal;

  /**
   * All-in PLN cost per share (purchase price + pro-rated buy commission,
   * both converted via fxRate at buy date).
   */
  costPerSharePLN: Decimal;

  /** `RawTransaction.id` of the BUY that opened this lot. */
  sourceTxId: string;
}

// ---------------------------------------------------------------------------
// FIFO match types — produced by the FIFO engine
// ---------------------------------------------------------------------------

/** The portion of a single lot consumed by one SELL. */
export interface FifoLotMatch {
  lotId: string;
  lotOpenDate: string;
  quantityConsumed: Decimal;
  costPerSharePLN: Decimal;
  /** quantityConsumed × costPerSharePLN */
  costPLN: Decimal;
}

/** Full record for one processed SELL transaction. */
export interface FifoMatch {
  sellTxId: string;
  symbol: string;
  sellDate: string;

  quantitySold: Decimal;

  /** sell grossAmount × fxRate */
  revenueGrossPLN: Decimal;

  /** sell commission × fxRate */
  commissionSellPLN: Decimal;

  /** Sum of FifoLotMatch.costPLN across all matched lots. */
  costBasisPLN: Decimal;

  /** revenueGrossPLN − commissionSellPLN − costBasisPLN */
  gainLossPLN: Decimal;

  lots: FifoLotMatch[];
}

// ---------------------------------------------------------------------------
// Dividend types
// ---------------------------------------------------------------------------

/**
 * One dividend event after FX enrichment.
 * `withholdingTaxPLN` is sourced from the matching WITHHOLDING_TAX transaction
 * (matched by symbol + date).
 */
export interface DividendItem {
  txId: string;
  symbol: string;

  /** "YYYY-MM-DD" */
  date: string;

  currency: Currency;
  grossAmountPLN: Decimal;

  /** Tax already deducted at source. >= 0. */
  withholdingTaxPLN: Decimal;
}

// ---------------------------------------------------------------------------
// Annual summaries — tax calculation outputs
// ---------------------------------------------------------------------------

export interface EquitySummary {
  year: number;

  /** Sum of all FifoMatch.revenueGrossPLN. */
  totalRevenuePLN: Decimal;

  /** Sum of all FifoMatch.costBasisPLN + commissionSellPLN. */
  totalCostPLN: Decimal;

  /** totalRevenuePLN − totalCostPLN (can be negative). */
  totalGainLossPLN: Decimal;

  /** max(0, totalGainLossPLN) */
  taxBase: Decimal;

  /** taxBase × 0.19 */
  taxDue: Decimal;

  matches: FifoMatch[];
}

export interface DividendSummary {
  year: number;

  grossDividendsPLN: Decimal;
  totalWithholdingTaxPLN: Decimal;

  /** grossDividendsPLN × 0.19 */
  polishTaxGross: Decimal;

  /** min(polishTaxGross, totalWithholdingTaxPLN) */
  taxCredit: Decimal;

  /** max(0, polishTaxGross − taxCredit) */
  taxDue: Decimal;

  items: DividendItem[];
}

export interface OtherIncomeSummary {
  year: number;
  totalIncomePLN: Decimal;
  totalCostPLN: Decimal;
  /** totalIncomePLN − totalCostPLN */
  gainLossPLN: Decimal;
  /** max(0, gainLossPLN × 0.19) */
  taxDue: Decimal;
}

/** Top-level result for a single tax year. */
export interface TaxSummary {
  year: number;
  equity: EquitySummary;
  dividends: DividendSummary;
  otherIncome: OtherIncomeSummary;
  /** equity.taxDue + dividends.taxDue + otherIncome.taxDue */
  totalTaxDue: Decimal;
}
