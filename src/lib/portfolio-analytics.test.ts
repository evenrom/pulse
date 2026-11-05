import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCompanyExposure, aggregateSectorCompanies, buildFundProfitHistory, calculateRiskContribution, type DailyPrice, type FundComposition, type PriceHistory } from "./portfolio-analytics";
import { parseIsharesHoldings, parseVanguardHoldings, parseYahooHistory } from "./analytics-providers";
import type { Transaction } from "./finance";
import { classifyVolatility, formatVolatility } from "./volatility";

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
  assert.ok(Math.abs(result.rows.reduce((sum, row) => sum + row.contribution!, 0) - 100) < 1e-9);
  assert.ok(result.rows[1].contribution! < 0);
  assert.ok(Math.abs(result.rows[0].contribution! - 133.3333333) < 1e-5);
  const expectedVolatility = Math.sqrt(150 / 149) * 0.01 * Math.sqrt(252) * 100;
  assert.ok(Math.abs(result.rows[0].annualizedVolatility - expectedVolatility) < 1e-8);
  // 80/20 opposite returns: portfolio volatility is 60% of either fund, not their average.
  assert.ok(Math.abs(result.annualizedPortfolioVolatility! - expectedVolatility * 0.6) < 1e-8);
  // The hedge is equally volatile on its own, despite its negative portfolio contribution.
  assert.ok(Math.abs(result.rows[0].annualizedVolatility - result.rows[1].annualizedVolatility) < 1e-8);
});

test("a constant-price cash allocation contributes no volatility and missing/short/stale histories cannot create a partial risk chart", () => {
  const assets = [{ ticker: "A", value: 50 }, { ticker: "CASH", value: 50 }];
  const histories = new Map([["A", riskSeries(returns)], ["CASH", riskSeries(returns.map(() => 0))]]);
  const result = calculateRiskContribution(assets, histories, now);
  assert.ok(Math.abs(result.rows[0].contribution! - 100) < 1e-8);
  assert.equal(result.rows[1].contribution, 0);
  assert.equal(result.rows[1].annualizedVolatility, 0);
  histories.delete("CASH");
  assert.equal(calculateRiskContribution(assets, histories, now).rows.length, 0);
  assert.equal(calculateRiskContribution(assets.slice(0, 1), histories, now + 30 * 86400000).rows.length, 0);
});

test("risk aligns full return intervals and uses adjusted prices rather than a dividend price drop", () => {
  const prices = riskSeries(returns);
  const dividend = { ...prices, prices: prices.prices.map((price, index) => ({ ...price, close: price.close * (index > 70 ? 0.9 : 1) })) };
  const result = calculateRiskContribution([{ ticker: "A", value: 50 }, { ticker: "B", value: 50 }], new Map([["A", prices], ["B", dividend]]), now);
  assert.ok(Math.abs(result.rows[0].contribution! - 50) < 1e-8);
  assert.ok(Math.abs(result.annualizedPortfolioVolatility! - result.rows[0].annualizedVolatility) < 1e-8);
  const missing = { ...prices, prices: prices.prices.filter((_, index) => index !== 71) };
  assert.equal(calculateRiskContribution([{ ticker: "A", value: 50 }, { ticker: "B", value: 50 }], new Map([["A", prices], ["B", missing]]), now).observations, 148);
});

test("a perfectly offset portfolio keeps valid fund and portfolio volatility without inventing relative contributions", () => {
  const result = calculateRiskContribution([{ ticker: "A", value: 50 }, { ticker: "B", value: 50 }], new Map([["A", riskSeries(returns)], ["B", riskSeries(returns.map(value => -value))]]), now);
  assert.equal(result.reason, null);
  assert.equal(result.observations, 150);
  assert.ok(result.annualizedPortfolioVolatility! < 1e-10);
  assert.ok(result.rows.every(row => row.annualizedVolatility > 15 && row.contribution === null));
});

test("uncorrelated equally weighted funds diversify by the covariance formula rather than averaging volatilities", () => {
  const first = Array.from({ length: 148 }, (_, i) => (i % 2 ? 1 : -1) * 0.01);
  const second = Array.from({ length: 148 }, (_, i) => (i % 4 < 2 ? 1 : -1) * 0.01);
  const result = calculateRiskContribution([{ ticker: "A", value: 50 }, { ticker: "B", value: 50 }], new Map([["A", riskSeries(first)], ["B", riskSeries(second)]]), now);
  const individual = Math.sqrt(148 / 147) * 0.01 * Math.sqrt(252) * 100;
  assert.equal(result.reason, null);
  assert.ok(Math.abs(result.annualizedPortfolioVolatility! - individual / Math.sqrt(2)) < 1e-8);
});

test("an entirely constant-price portfolio has zero volatility; absent or insufficient samples have no portfolio estimate", () => {
  const result = calculateRiskContribution([{ ticker: "CASH", value: 100 }], new Map([["CASH", riskSeries(returns.map(() => 0))]]), now);
  assert.equal(result.annualizedPortfolioVolatility, 0);
  assert.equal(result.rows[0].annualizedVolatility, 0);
  assert.equal(result.rows[0].contribution, null);
  assert.equal(calculateRiskContribution([{ ticker: "CASH", value: 100 }], new Map(), now).annualizedPortfolioVolatility, null);
});

test("volatility display bands share exact boundaries, preserve zero and reject missing/invalid observations", () => {
  for (const value of [0, 0.2, 4.999]) assert.equal(classifyVolatility(value)?.key, "low");
  for (const value of [5, 10, 14.999]) assert.equal(classifyVolatility(value)?.key, "medium");
  for (const value of [15, 20, 100]) assert.equal(classifyVolatility(value)?.key, "high");
  for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(classifyVolatility(value), null);
  assert.equal(formatVolatility(4.999), "<5.0%");
  assert.equal(formatVolatility(14.999), "<15.0%");
  assert.equal(formatVolatility(15), "15.0%");
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

test("sector rankings merge fund exposure and share classes before taking the top five in each sector", () => {
  const holdings = (rows: [string, string | undefined, number][]): FundComposition => ({
    asOf: "2026-01-01", source: "test", equityWeight: 1,
    holdings: rows.map(([symbol, sector, weight]) => ({ symbol, name: symbol, sector, weight, country: "United States" })),
  });
  const result = aggregateSectorCompanies([
    { ticker: "VOO", value: 40 }, { ticker: "USMV", value: 10 }, { ticker: "SGOV", value: 45 }, { ticker: "IAU", value: 5 },
  ], new Map([
    ["VOO", holdings([
      ["GOOG", "Communications", 0.03], ["GOOGL", "Communications", 0.02],
      ["NVDA", "Technology", 0.1], ["UNMAPPED", undefined, 0.05],
      ...Array.from({ length: 6 }, (_, index): [string, string, number] => [`T${index}`, "Technology", (index + 1) / 100]),
    ])],
    ["USMV", holdings([["NVDA", "Technology", 0.02]])],
  ]));
  assert.deepEqual(result.sectors.Technology.map(row => row.name), ["NVDA", "T5", "T4", "T3", "T2"]);
  assert.ok(Math.abs(result.sectors.Technology[0].weight - 4.2) < 1e-9);
  assert.equal(result.sectors.Communications.length, 1);
  assert.ok(Math.abs(result.sectors.Communications[0].weight - 2) < 1e-9);
  assert.deepEqual(result.incompleteTickers, ["VOO"]);
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
