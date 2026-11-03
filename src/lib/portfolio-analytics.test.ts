import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCompanyExposure, buildFundProfitHistory, calculateRiskContribution, type DailyPrice, type FundComposition, type PriceHistory } from "./portfolio-analytics";
import { parseIsharesHoldings, parseVanguardHoldings, parseYahooHistory } from "./analytics-providers";
import type { Transaction } from "./finance";

const trade = (values: Partial<Transaction>): Transaction => ({ id: "tx", ticker: "VOO", action: "BUY", date: "2026-01-02", quantity: 10, price: 100, fees: 0, total_amount: 1000, historic_rate: 3.5, realized_pl: 0, created_at: "1", ...values });
const history = (prices: DailyPrice[]): PriceHistory => ({ prices, requestedFrom: "2025-01-01", splitDates: [] });
const day = (date: string, close: number): DailyPrice => ({ date, close, adjustedClose: close });

test("fund profit follows transaction quantities, includes realized gains and DRIP once, and preserves the existing ILS lens", () => {
  const txs = [trade({}), trade({ id: "drip", date: "2026-01-05", action: "DRIP", quantity: 1, total_amount: 100 }), trade({ id: "sale", date: "2026-01-06", action: "SELL", quantity: 5, total_amount: 600, realized_pl: 100 })];
  const result = buildFundProfitHistory("VOO", txs, history([day("2026-01-01", 100), day("2026-01-02", 100), day("2026-01-05", 100), day("2026-01-06", 120)]), 3.5);
  assert.deepEqual(result.points.map(point => point.usd), [0, 10, 64]);
  assert.deepEqual(result.points.map(point => point.ils), [0, 10, 64]);
});

test("fund history rejects uncovered starts and unreconciled splits; zero remaining basis is undefined, not an invented return", () => {
  assert.match(buildFundProfitHistory("VOO", [trade({})], history([day("2026-01-03", 100)]), 3.5).reason!, /first transaction/);
  assert.match(buildFundProfitHistory("VOO", [trade({})], { ...history([day("2026-01-01", 100)]), splitDates: ["2026-01-03"] }, 3.5).reason!, /split/);
  const txs = [trade({}), trade({ action: "SELL", date: "2026-01-03", quantity: 10, total_amount: 1200, realized_pl: 200 })];
  assert.equal(buildFundProfitHistory("VOO", txs, history([day("2026-01-01", 100), day("2026-01-03", 120)]), 3.5).points[0].usd, null);
});

function riskSeries(returns: number[]) {
  let price = 100;
  return history([day("2026-01-01", price), ...returns.map((value, i) => { price *= 1 + value; return day(new Date(Date.UTC(2026, 0, i + 2)).toISOString().slice(0, 10), price); })]);
}
const now = Date.parse("2026-06-01T12:00:00Z");
const returns = Array.from({ length: 150 }, (_, i) => (i % 2 ? 1 : -1) * 0.01);

test("volatility contributions reconcile to 100%, respect covariances and can be negative", () => {
  const result = calculateRiskContribution([{ ticker: "A", value: 80 }, { ticker: "HEDGE", value: 20 }], new Map([["A", riskSeries(returns)], ["HEDGE", riskSeries(returns.map(value => -value))]]), now);
  assert.equal(result.reason, null);
  assert.ok(Math.abs(result.rows.reduce((sum, row) => sum + row.contribution, 0) - 100) < 1e-9);
  assert.ok(result.rows[1].contribution < 0);
  assert.ok(Math.abs(result.rows[0].contribution - 133.3333333) < 1e-5);
});

test("a constant-price cash allocation contributes no volatility and missing/short/stale histories cannot create a partial risk chart", () => {
  const assets = [{ ticker: "A", value: 50 }, { ticker: "CASH", value: 50 }];
  const histories = new Map([["A", riskSeries(returns)], ["CASH", riskSeries(returns.map(() => 0))]]);
  const result = calculateRiskContribution(assets, histories, now);
  assert.ok(Math.abs(result.rows[0].contribution - 100) < 1e-8);
  assert.equal(result.rows[1].contribution, 0);
  histories.delete("CASH");
  assert.equal(calculateRiskContribution(assets, histories, now).rows.length, 0);
  assert.equal(calculateRiskContribution(assets.slice(0, 1), histories, now + 30 * 86400000).rows.length, 0);
});

test("risk aligns full return intervals and uses adjusted prices rather than a dividend price drop", () => {
  const prices = riskSeries(returns);
  const dividend = { ...prices, prices: prices.prices.map((price, index) => ({ ...price, close: price.close * (index > 70 ? 0.9 : 1) })) };
  const result = calculateRiskContribution([{ ticker: "A", value: 50 }, { ticker: "B", value: 50 }], new Map([["A", prices], ["B", dividend]]), now);
  assert.ok(Math.abs(result.rows[0].contribution - 50) < 1e-8);
  const missing = { ...prices, prices: prices.prices.filter((_, index) => index !== 71) };
  assert.equal(calculateRiskContribution([{ ticker: "A", value: 50 }, { ticker: "B", value: 50 }], new Map([["A", prices], ["B", missing]]), now).observations, 148);
});

test("company exposures use the whole portfolio denominator, combine share classes, and do not conflate tickers in different countries", () => {
  const composition: FundComposition = { holdings: [{ symbol: "GOOG", name: "Alphabet", country: "United States", weight: 0.1 }, { symbol: "GOOGL", name: "Alphabet A", country: "United States", weight: 0.2 }, { symbol: "ROP", name: "Roper", country: "United States", weight: 0.1 }], asOf: "2026-01-01", source: "test", equityWeight: 0.4 };
  const international: FundComposition = { ...composition, holdings: [{ symbol: "ROP", name: "Roche", country: "Switzerland", weight: 0.2 }], equityWeight: 0.2 };
  const result = aggregateCompanyExposure([{ ticker: "VOO", value: 200 }, { ticker: "IDEV", value: 100 }, { ticker: "SGOV", value: 500 }, { ticker: "IAU", value: 200 }], new Map([["VOO", composition], ["IDEV", international]]));
  assert.equal(result.companies.length, 3);
  assert.ok(Math.abs(result.companies[0].weight - 6) < 1e-10);
  assert.equal(result.companies[0].symbols.length, 2);
  assert.equal(result.coveredPortfolioPct, 10);
  assert.equal(result.equityPortfolioPct, 30);
  assert.deepEqual(aggregateCompanyExposure([{ ticker: "MISSING", value: 100 }], new Map()).missingTickers, ["MISSING"]);
});

test("issuer parsers handle CSV preambles/quotes and reject incomplete holdings rather than normalizing top-ten data", () => {
  const rows = Array.from({ length: 20 }, (_, i) => `"T${i}","Company, ${i}",Equity,5.00,United States`).join("\r\n");
  const csv = `Fund\r\nFund Holdings as of,"Jan 02, 2026"\r\n\r\nTicker,Name,Asset Class,Weight (%),Location\r\n${rows}`;
  const result = parseIsharesHoldings(csv);
  assert.equal(result.holdings[0].name, "Company, 0");
  assert.equal(result.asOf, "2026-01-02");
  assert.throws(() => parseIsharesHoldings(csv.replace(rows, rows.split("\r\n").slice(0, 10).join("\r\n"))), /Incomplete/);
  assert.throws(() => parseVanguardHoldings({ holdingDetails: { asOfDate: "01/02/2026", equityHoldings: [] } }), /missing/);
  const equityHoldings = Array.from({ length: 20 }, (_, i) => ({ securityType: "EQ.STOCK", ticker: `T${i}`, securityLongDescription: `Company ${i}`, marketValuePercentage: "5.00%" }));
  equityHoldings[0].securityType = "EQ.REIT";
  const vanguard = parseVanguardHoldings({ holdingDetails: { asOfDate: "01/02/2026", equityHoldings: [...equityHoldings, { securityType: "EQ.RIGHT", securityLongDescription: "Contingent rights" }] } });
  assert.equal(vanguard.holdings.length, 20);
  assert.equal(vanguard.asOf, "2026-01-02");
});

test("Yahoo parser excludes an unfinished daily candle, preserves raw/adjusted prices and split dates", () => {
  const timestamp = [Date.parse("2026-06-01T13:30:00Z") / 1000, Date.parse("2026-06-02T13:30:00Z") / 1000];
  const payload = { chart: { result: [{ timestamp, indicators: { quote: [{ close: [100, 99] }], adjclose: [{ adjclose: [98, 99] }] }, meta: { currentTradingPeriod: { regular: { end: Date.parse("2026-06-02T20:00:00Z") / 1000 } } }, events: { splits: { a: { date: timestamp[0] } } } }] } };
  const result = parseYahooHistory(payload, "2026-01-01", Date.parse("2026-06-02T16:00:00Z"));
  assert.deepEqual(result.prices, [{ date: "2026-06-01", close: 100, adjustedClose: 98 }]);
  assert.deepEqual(result.splitDates, ["2026-06-01"]);
  assert.throws(() => parseYahooHistory({ chart: { result: [] } }, "2026-01-01"));
});
