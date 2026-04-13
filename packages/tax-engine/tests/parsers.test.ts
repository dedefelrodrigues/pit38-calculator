import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { parseDegiroTrades, parseDegiroAccount, parseDegiroDate, splitCsvLine } from "../src/degiro.js";

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
