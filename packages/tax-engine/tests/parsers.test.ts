import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  parseDegiroTrades,
  parseDegiroAccount,
  parseDegiroDate,
  splitCsvLine,
} from "../src/degiro.js";
import { parseIbkrActivity, parseIbkrDate } from "../src/ibkr.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dec(s: string | number): Decimal {
  return new Decimal(s);
}

// ---------------------------------------------------------------------------
// parseDegiroDate
// ---------------------------------------------------------------------------

describe("parseDegiroDate", () => {
  it("converts DD-MM-YYYY to YYYY-MM-DD", () => {
    expect(parseDegiroDate("10-04-2024")).toBe("2024-04-10");
    expect(parseDegiroDate("01-01-2023")).toBe("2023-01-01");
    expect(parseDegiroDate("31-12-2020")).toBe("2020-12-31");
  });

  it("returns null for unrecognised formats", () => {
    expect(parseDegiroDate("2024-04-10")).toBeNull();
    expect(parseDegiroDate("10/04/2024")).toBeNull();
    expect(parseDegiroDate("")).toBeNull();
    expect(parseDegiroDate(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// splitCsvLine
// ---------------------------------------------------------------------------

describe("splitCsvLine", () => {
  it("splits on commas", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("preserves empty fields", () => {
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
    expect(splitCsvLine(",b,")).toEqual(["", "b", ""]);
  });

  it("respects double-quoted fields containing commas", () => {
    expect(splitCsvLine('"hello, world",b,c')).toEqual(["hello, world", "b", "c"]);
  });

  it("trailing comma produces empty last field", () => {
    expect(splitCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

// ---------------------------------------------------------------------------
// parseDegiroTrades — sample CSV from reference/sample-degiro.csv
// ---------------------------------------------------------------------------

const TRADES_CSV = `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,
10-04-2024,12:23,SAP SE,DE0007164600,XET,XETA,-50,171.9600,EUR,8598.00,EUR,8598.00,,0.00,-4.90,8593.10,,1798be6a-8946-41d7-95b0-187432d4a16a
25-10-2023,09:00,SAP SE,DE0007164600,XET,XETA,-50,125.5000,EUR,6275.00,EUR,6275.00,,0.00,-4.90,6270.10,,2bf919d2-bc64-47e6-92f7-efd9a34600c6
18-12-2020,12:20,SAP SE,DE0007164600,XET,XETA,200,105.8800,EUR,-21176.00,EUR,-21176.00,,0.00,-14.59,-21190.59,,90292115-9c92-42ef-b6bb-fafe0395acf5
25-02-2022,15:44,BASF SE,DE000BASF111,XET,XETA,100,59.4800,EUR,-5948.00,EUR,-5948.00,,0.00,-4.40,-5952.40,,9ae0324d-33de-4b99-a9a0-994526b5360e`;

describe("parseDegiroTrades", () => {
  it("skips the header row", () => {
    const txs = parseDegiroTrades(TRADES_CSV);
    expect(txs).toHaveLength(4);
  });

  it("parses a SELL row correctly", () => {
    const txs = parseDegiroTrades(TRADES_CSV);
    const sell = txs[0]; // 10-04-2024 SAP SELL 50

    expect(sell.type).toBe("SELL");
    expect(sell.broker).toBe("degiro");
    expect(sell.date).toBe("2024-04-10");
    expect(sell.symbol).toBe("DE0007164600");
    expect(sell.isin).toBe("DE0007164600");
    expect(sell.name).toBe("SAP SE");
    expect(sell.currency).toBe("EUR");
    expect(sell.quantity!.toNumber()).toBe(50);
    expect(sell.pricePerShare!.toNumber()).toBe(171.96);
    expect(sell.grossAmount.toNumber()).toBe(8598.0);
    expect(sell.commission.toNumber()).toBe(4.9);
    // netAmount = gross − commission for SELL
    expect(sell.netAmount.toNumber()).toBe(8593.1);
    expect(sell.id).toBe("1798be6a-8946-41d7-95b0-187432d4a16a");
  });

  it("parses a BUY row correctly", () => {
    const txs = parseDegiroTrades(TRADES_CSV);
    const buy = txs[2]; // 18-12-2020 SAP BUY 200

    expect(buy.type).toBe("BUY");
    expect(buy.date).toBe("2020-12-18");
    expect(buy.symbol).toBe("DE0007164600");
    expect(buy.quantity!.toNumber()).toBe(200);
    expect(buy.pricePerShare!.toNumber()).toBeCloseTo(105.88, 2);
    expect(buy.grossAmount.toNumber()).toBe(21176.0);
    expect(buy.commission.toNumber()).toBe(14.59);
    // netAmount = gross + commission for BUY
    expect(buy.netAmount.toNumber()).toBe(21190.59);
    expect(buy.id).toBe("90292115-9c92-42ef-b6bb-fafe0395acf5");
  });

  it("parses a different symbol (BASF) independently", () => {
    const txs = parseDegiroTrades(TRADES_CSV);
    const basf = txs[3];

    expect(basf.type).toBe("BUY");
    expect(basf.symbol).toBe("DE000BASF111");
    expect(basf.name).toBe("BASF SE");
    expect(basf.quantity!.toNumber()).toBe(100);
    expect(basf.grossAmount.toNumber()).toBe(5948.0);
    expect(basf.commission.toNumber()).toBe(4.4);
  });

  it("returns empty array for CSV with only a header", () => {
    const header =
      "Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,";
    expect(parseDegiroTrades(header)).toEqual([]);
  });

  it("skips rows with zero quantity", () => {
    const csv = `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,
10-04-2024,12:23,SAP SE,DE0007164600,XET,XETA,0,171.96,EUR,0.00,EUR,0.00,,0.00,0.00,0.00,,`;
    expect(parseDegiroTrades(csv)).toHaveLength(0);
  });

  it("uses EUR values when local currency is not EUR (AutoFX trade)", () => {
    // Simulated non-EUR trade: local value in USD, exchange rate present
    const csv = `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,
15-03-2024,10:00,Apple Inc,US0378331005,NDQ,XNAS,10,175.00,USD,-1750.00,USD,-1600.00,1.0938,0.00,-4.90,-1604.90,,abc-123`;

    const txs = parseDegiroTrades(csv);
    expect(txs).toHaveLength(1);
    const tx = txs[0];

    // Non-EUR: should normalise to EUR (Value EUR column)
    expect(tx.currency).toBe("EUR");
    expect(tx.grossAmount.toNumber()).toBe(1600.0);
    expect(tx.commission.toNumber()).toBe(4.9);
  });

  it("generates an id when the UUID column is absent", () => {
    const csv = `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,
10-04-2024,12:23,SAP SE,DE0007164600,XET,XETA,-50,171.96,EUR,8598.00,EUR,8598.00,,0.00,-4.90,8593.10,,`;
    const txs = parseDegiroTrades(csv);
    expect(txs[0].id).toBeTruthy();
    expect(txs[0].id.length).toBeGreaterThan(0);
  });

  it("uses ISIN as symbol, falling back to product name when ISIN absent", () => {
    const csv = `Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,
10-04-2024,12:23,SAP SE,,XET,XETA,-50,171.96,EUR,8598.00,EUR,8598.00,,0.00,-4.90,8593.10,,some-uuid`;
    const txs = parseDegiroTrades(csv);
    expect(txs[0].symbol).toBe("SAP SE");
    expect(txs[0].isin).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseDegiroAccount — dividends, withholding tax, fees, interest
// ---------------------------------------------------------------------------

const ACCOUNT_CSV = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
24-02-2026,01:50,23-02-2026,,,Degiro Cash Sweep Transfer,,EUR,2.50,EUR,24818.78,
24-02-2026,01:50,23-02-2026,,,Transfer from your Cash Account at flatexDEGIRO Bank SE: 2.5 EUR,,,,EUR,24816.28,
23-02-2026,10:43,31-01-2026,,,DEGIRO Exchange Connection Fee 2026 (Xetra - XET),,EUR,-2.50,EUR,24818.78,
05-01-2026,08:10,02-01-2026,,,Flatex Interest Income,,EUR,0.01,EUR,24821.28,
15-03-2024,09:00,15-03-2024,SAP SE,DE0007164600,Dividend,,EUR,50.00,EUR,1050.00,div-001
15-03-2024,09:00,15-03-2024,SAP SE,DE0007164600,Withholding tax,,EUR,-7.50,EUR,1042.50,wht-001`;

describe("parseDegiroAccount", () => {
  it("skips header, cash sweeps and transfers", () => {
    const txs = parseDegiroAccount(ACCOUNT_CSV);
    // Should include: fee, interest, dividend, withholding tax = 4 rows
    expect(txs).toHaveLength(4);
  });

  it("classifies DEGIRO connection fee as FEE", () => {
    const txs = parseDegiroAccount(ACCOUNT_CSV);
    const fee = txs.find((t) => t.type === "FEE");

    expect(fee).toBeDefined();
    expect(fee!.date).toBe("2026-02-23");
    expect(fee!.grossAmount.toNumber()).toBe(2.5);
    expect(fee!.currency).toBe("EUR");
    expect(fee!.commission.toNumber()).toBe(0);
  });

  it("classifies interest income as OTHER_INCOME", () => {
    const txs = parseDegiroAccount(ACCOUNT_CSV);
    const interest = txs.find((t) => t.type === "OTHER_INCOME");

    expect(interest).toBeDefined();
    expect(interest!.date).toBe("2026-01-05");
    expect(interest!.grossAmount.toNumber()).toBe(0.01);
  });

  it("classifies dividend row as DIVIDEND", () => {
    const txs = parseDegiroAccount(ACCOUNT_CSV);
    const div = txs.find((t) => t.type === "DIVIDEND");

    expect(div).toBeDefined();
    expect(div!.date).toBe("2024-03-15");
    expect(div!.symbol).toBe("DE0007164600");
    expect(div!.isin).toBe("DE0007164600");
    expect(div!.name).toBe("SAP SE");
    expect(div!.grossAmount.toNumber()).toBe(50.0);
    expect(div!.currency).toBe("EUR");
    expect(div!.id).toBe("div-001");
  });

  it("classifies withholding tax row as WITHHOLDING_TAX", () => {
    const txs = parseDegiroAccount(ACCOUNT_CSV);
    const wht = txs.find((t) => t.type === "WITHHOLDING_TAX");

    expect(wht).toBeDefined();
    expect(wht!.date).toBe("2024-03-15");
    expect(wht!.symbol).toBe("DE0007164600");
    // grossAmount is always positive regardless of CSV sign
    expect(wht!.grossAmount.toNumber()).toBe(7.5);
    expect(wht!.id).toBe("wht-001");
  });

  it("skips rows with zero change amount", () => {
    const csv = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
05-01-2026,08:10,02-01-2026,,,Flatex Interest Income,,EUR,0.00,EUR,24821.28,`;
    expect(parseDegiroAccount(csv)).toHaveLength(0);
  });

  it("handles USD-denominated dividend", () => {
    const csv = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
15-03-2024,09:00,15-03-2024,Apple Inc,US0378331005,Dividend,,USD,1.25,USD,100.25,div-usd`;
    const txs = parseDegiroAccount(csv);
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe("DIVIDEND");
    expect(txs[0].currency).toBe("USD");
    expect(txs[0].grossAmount.toNumber()).toBe(1.25);
  });

  it("does not classify unknown rows", () => {
    const csv = `Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id
10-01-2024,08:00,10-01-2024,,,Some Unknown Operation,,EUR,5.00,EUR,100.00,`;
    expect(parseDegiroAccount(csv)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseIbkrDate
// ---------------------------------------------------------------------------

describe("parseIbkrDate", () => {
  it("extracts date from IBKR datetime string", () => {
    expect(parseIbkrDate("2022-09-02, 14:32:10")).toBe("2022-09-02");
    expect(parseIbkrDate("2024-06-10, 20:25:00")).toBe("2024-06-10");
  });

  it("accepts plain ISO date", () => {
    expect(parseIbkrDate("2024-06-10")).toBe("2024-06-10");
  });

  it("returns null for empty or invalid input", () => {
    expect(parseIbkrDate("")).toBeNull();
    expect(parseIbkrDate(undefined)).toBeNull();
    expect(parseIbkrDate("06/10/2024")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseIbkrActivity — combined fixture
// ---------------------------------------------------------------------------

// Minimal multi-section IBKR activity statement covering all handled sections.
const IBKR_CSV = `Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Underlying,Listing Exch,Multiplier,Type,Code
Financial Instrument Information,Data,Stocks,NVDA,NVIDIA CORP,4815747,US67066G1040,,NASDAQ,1,COMMON,
Financial Instrument Information,Data,Stocks,ABBV,ABBVIE INC,118089500,US00287Y1091,,NYSE,1,COMMON,
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Realized P/L %,MTM P/L,Code
Trades,Data,Order,Stocks,USD,NVDA,"2022-09-02, 14:32:10",10,136.82,136.5,-1368.2,-0.35,1368.55,0,0,-3.2,O
Trades,Data,Order,Stocks,USD,NVDA,"2025-11-26, 10:15:00",-5,1814,1810,9070,-0.52,-6426.57,2643.43,0.41112,0,C
Trades,SubTotal,,Stocks,USD,NVDA,,0,,,7701.8,-0.87,,,,,
Trades,Total,,Stocks,USD,,,,,,,,,,,,,
Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2022-09-29,ABBV(US00287Y1091) Cash Dividend USD 1.30 per Share (Ordinary Dividend),65
Dividends,Data,Total,,,65
Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,USD,2022-09-29,ABBV(US00287Y1091) Cash Dividend USD 1.30 per Share - US Tax,-9.75,
Withholding Tax,Data,Total,,,-9.75,
Corporate Actions,Header,Asset Category,Currency,Report Date,Date/Time,Description,Quantity,Proceeds,Value,Realized P/L,Code
Corporate Actions,Data,Stocks,USD,2024-06-10,"2024-06-07, 20:25:00","NVDA(US67066G1040) Split 10 for 1 (NVDA, NVIDIA CORP, US67066G1040)",108,0,0,0,
Corporate Actions,Data,Total,,,,,,0,0,0,`;

describe("parseIbkrActivity — trades", () => {
  it("parses a BUY trade correctly", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const buy = txs.find((t) => t.type === "BUY" && t.symbol === "NVDA");
    expect(buy).toBeDefined();
    expect(buy!.broker).toBe("ibkr");
    expect(buy!.date).toBe("2022-09-02");
    expect(buy!.symbol).toBe("NVDA");
    expect(buy!.isin).toBe("US67066G1040");
    expect(buy!.name).toBe("NVIDIA CORP");
    expect(buy!.currency).toBe("USD");
    expect(buy!.quantity!.toNumber()).toBe(10);
    expect(buy!.pricePerShare!.toNumber()).toBe(136.82);
    // grossAmount = abs(Proceeds) = 1368.2
    expect(buy!.grossAmount.toNumber()).toBe(1368.2);
    // commission = abs(Comm/Fee) = 0.35
    expect(buy!.commission.toNumber()).toBe(0.35);
    // netAmount = gross + commission for BUY
    expect(buy!.netAmount.toNumber()).toBe(1368.55);
  });

  it("parses a SELL trade correctly", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const sell = txs.find((t) => t.type === "SELL" && t.symbol === "NVDA");
    expect(sell).toBeDefined();
    expect(sell!.date).toBe("2025-11-26");
    expect(sell!.quantity!.toNumber()).toBe(5);
    expect(sell!.pricePerShare!.toNumber()).toBe(1814);
    // grossAmount = abs(Proceeds) = 9070
    expect(sell!.grossAmount.toNumber()).toBe(9070);
    expect(sell!.commission.toNumber()).toBe(0.52);
    // netAmount = gross − commission for SELL
    expect(sell!.netAmount.toNumber()).toBe(9069.48);
  });

  it("enriches trades with ISIN and name from Financial Instrument Information", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const buy = txs.find((t) => t.type === "BUY" && t.symbol === "NVDA");
    expect(buy!.isin).toBe("US67066G1040");
    expect(buy!.name).toBe("NVIDIA CORP");
  });

  it("skips SubTotal and Total rows", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const trades = txs.filter((t) => t.type === "BUY" || t.type === "SELL");
    expect(trades).toHaveLength(2);
  });
});

describe("parseIbkrActivity — dividends", () => {
  it("parses a USD dividend correctly", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const div = txs.find((t) => t.type === "DIVIDEND");
    expect(div).toBeDefined();
    expect(div!.date).toBe("2022-09-29");
    expect(div!.symbol).toBe("ABBV");
    expect(div!.isin).toBe("US00287Y1091");
    expect(div!.currency).toBe("USD");
    expect(div!.grossAmount.toNumber()).toBe(65);
    expect(div!.commission.toNumber()).toBe(0);
  });

  it("skips Dividends Total row", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const divs = txs.filter((t) => t.type === "DIVIDEND");
    expect(divs).toHaveLength(1);
  });
});

describe("parseIbkrActivity — withholding tax", () => {
  it("parses withholding tax as positive grossAmount", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const wht = txs.find((t) => t.type === "WITHHOLDING_TAX");
    expect(wht).toBeDefined();
    expect(wht!.date).toBe("2022-09-29");
    expect(wht!.symbol).toBe("ABBV");
    expect(wht!.isin).toBe("US00287Y1091");
    expect(wht!.currency).toBe("USD");
    // IBKR reports as -9.75 → stored as positive 9.75
    expect(wht!.grossAmount.toNumber()).toBe(9.75);
  });
});

describe("parseIbkrActivity — corporate actions (stock splits)", () => {
  it("parses a 10:1 split with correct ratio", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const split = txs.find((t) => t.type === "STOCK_SPLIT");
    expect(split).toBeDefined();
    expect(split!.symbol).toBe("NVDA");
    expect(split!.isin).toBe("US67066G1040");
    expect(split!.date).toBe("2024-06-10");
    // ratio = 10/1 = 10
    expect(split!.quantity!.toNumber()).toBe(10);
  });

  it("skips Corporate Actions Total row", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const splits = txs.filter((t) => t.type === "STOCK_SPLIT");
    expect(splits).toHaveLength(1);
  });
});

describe("parseIbkrActivity — corporate actions (merger / acquisition)", () => {
  const MERGER_CSV = `Corporate Actions,Header,Asset Category,Currency,Report Date,Date/Time,Description,Quantity,Proceeds,Value,Realized P/L,Code
Corporate Actions,Data,Stocks,USD,2023-06-29,"2023-06-28, 20:25:00","XM(US7476012015) Merged(Acquisition) for USD 18.15 per Share (XM, QUALTRICS INTERNATIONAL-CL A, US7476012015)",-130,2359.5,-2358.2,-2782.151386,
Corporate Actions,Data,Total,,,,,,2359.5,-2358.2,-2782.151386,`;

  it("produces a SELL transaction for the acquired shares", () => {
    const txs = parseIbkrActivity(MERGER_CSV);
    expect(txs).toHaveLength(1);
    const tx = txs[0]!;
    expect(tx.type).toBe("SELL");
    expect(tx.broker).toBe("ibkr");
    expect(tx.date).toBe("2023-06-29");
    expect(tx.symbol).toBe("XM");
    expect(tx.isin).toBe("US7476012015");
    expect(tx.currency).toBe("USD");
  });

  it("sets quantity to the absolute number of shares removed", () => {
    const txs = parseIbkrActivity(MERGER_CSV);
    expect(txs[0]!.quantity!.toNumber()).toBe(130);
  });

  it("sets grossAmount from Proceeds and computes pricePerShare", () => {
    const txs = parseIbkrActivity(MERGER_CSV);
    const tx = txs[0]!;
    // Proceeds = 2359.5, quantity = 130 → price = 18.15
    expect(tx.grossAmount.toNumber()).toBe(2359.5);
    expect(tx.pricePerShare!.toFixed(2)).toBe("18.15");
    expect(tx.commission.toNumber()).toBe(0);
    expect(tx.netAmount.toNumber()).toBe(2359.5);
  });

  it("skips the Total row", () => {
    const txs = parseIbkrActivity(MERGER_CSV);
    expect(txs).toHaveLength(1);
  });
});

describe("parseIbkrActivity — corporate actions (delisting)", () => {
  const DELISTED_CSV = `Corporate Actions,Header,Asset Category,Currency,Report Date,Date/Time,Description,Quantity,Proceeds,Value,Realized P/L,Code
Corporate Actions,Data,Stocks,USD,2026-02-24,"2026-02-23, 20:25:00","(US87663X1028) Delisted (TTCF, TATTOOED CHEF INC, US87663X1028)",-150,0,0,-1011.255385,
Corporate Actions,Data,Total,,,,,,0,0,-1011.255385,`;

  it("produces a SELL at zero proceeds for delisted shares", () => {
    const txs = parseIbkrActivity(DELISTED_CSV);
    expect(txs).toHaveLength(1);
    const tx = txs[0]!;
    expect(tx.type).toBe("SELL");
    expect(tx.date).toBe("2026-02-24");
    expect(tx.symbol).toBe("TTCF");
    expect(tx.isin).toBe("US87663X1028");
    expect(tx.currency).toBe("USD");
    expect(tx.quantity!.toNumber()).toBe(150);
    expect(tx.grossAmount.toNumber()).toBe(0);
    expect(tx.commission.toNumber()).toBe(0);
    // pricePerShare omitted when zero
    expect(tx.pricePerShare).toBeUndefined();
  });
});

describe("parseIbkrActivity — filtering and edge cases", () => {
  it("returns empty array for empty CSV", () => {
    expect(parseIbkrActivity("")).toHaveLength(0);
  });

  it("ignores non-Stocks trade rows (Options, Forex, etc.)", () => {
    const csv = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Realized P/L %,MTM P/L,Code
Trades,Data,Order,Options,USD,NVDA  240119C00500000,"2024-01-19, 10:00:00",-1,5.5,5.4,550,-0.70,0,0,0,150,C
Trades,Data,Order,Forex,USD,EUR.USD,"2024-01-15, 09:00:00",1000,1.09,1.09,-1090,-0.5,0,0,0,0,O`;
    expect(parseIbkrActivity(csv)).toHaveLength(0);
  });

  it("ignores truly unrecognised corporate actions (not split/merger/delisting)", () => {
    const csv = `Corporate Actions,Header,Asset Category,Currency,Report Date,Date/Time,Description,Quantity,Proceeds,Value,Realized P/L,Code
Corporate Actions,Data,Stocks,USD,2024-01-01,"2023-12-31, 20:25:00","XYZ(US1234567890) Name Change (XYZ, OLD NAME INC, US1234567890)",0,0,0,0,`;
    expect(parseIbkrActivity(csv)).toHaveLength(0);
  });

  it("handles amounts with thousands commas", () => {
    const csv = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Realized P/L %,MTM P/L,Code
Trades,Data,Order,Stocks,USD,SPY,"2024-01-15, 10:00:00",100,479.5,479,-47950,-1.05,47951.05,0,0,-50,O`;
    const txs = parseIbkrActivity(csv);
    expect(txs).toHaveLength(1);
    expect(txs[0].grossAmount.toNumber()).toBe(47950);
    expect(txs[0].commission.toNumber()).toBe(1.05);
  });

  it("assigns unique ids to each transaction", () => {
    const txs = parseIbkrActivity(IBKR_CSV);
    const ids = txs.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
