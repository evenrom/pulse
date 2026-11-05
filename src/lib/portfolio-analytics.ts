import { calculateAssetMetrics, calculateHoldings, type Transaction } from "./finance";

export type DailyPrice = { date: string; close: number; adjustedClose: number };
export type PriceHistory = { prices: DailyPrice[]; requestedFrom: string; splitDates: string[] };
export type FundHolding = { symbol: string; name: string; country: string; weight: number; sector?: string };
export type FundComposition = {
  holdings: FundHolding[]; asOf: string; source: string; equityWeight: number;
  nonEquityWeight?: number;
  sectorSource?: "issuer" | "ivv" | null;
  geography?: { basis: "holdings" | "fund-scope" | "unavailable"; country?: string; asOf?: string };
};
export type FundProfitPoint = { date: string; usd: number | null; ils: number | null };
export type RiskContribution = {
  rows: { ticker: string; weight: number; contribution: number | null; annualizedVolatility: number }[];
  annualizedPortfolioVolatility: number | null;
  observations: number;
  from: string | null;
  through: string | null;
  reason: string | null;
};
export type CompanyExposure = {
  companies: { id: string; name: string; symbols: string[]; weight: number; funds: string[] }[];
  sources: { ticker: string; source: string; asOf: string; refreshedAt: string; stale: boolean }[];
  missingTickers: string[];
  coveredPortfolioPct: number;
  equityPortfolioPct: number;
};
export type PortfolioAnalytics = {
  funds: { ticker: string; points: FundProfitPoint[]; reason: string | null; through: string | null; stale: boolean }[];
  risk: RiskContribution;
  exposure: CompanyExposure;
  sectorCompanies: SectorCompanyExposure;
  regional: import("./allocation").RegionalAllocation;
  warnings: string[];
};

export type SectorCompanyExposure = {
  sectors: Record<string, { id: string; name: string; weight: number }[]>;
  incompleteTickers: string[];
};

/** Same profit/cost definition as Portfolio Profit; a time filter never rebases it. */
export function buildFundProfitHistory(ticker: string, txs: Transaction[], history: PriceHistory, exchangeRate: number) {
  const trades = txs.filter(tx => tx.ticker === ticker).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const firstDate = trades[0]?.date?.slice(0, 10);
  if (!firstDate) return { points: [], reason: "No recorded transactions." };
  // The ledger has no split action. Never silently mix adjusted prices with pre-split quantities.
  if (history.splitDates.some(date => date >= firstDate)) return { points: [], reason: "A stock split needs reconciliation with the transaction ledger." };
  if (!history.prices.length || history.prices[0].date > firstDate) return { points: [], reason: "Price history does not cover the first transaction." };
  const points: FundProfitPoint[] = [];
  const through: Transaction[] = [];
  let index = 0;
  for (const day of history.prices) {
    if (day.date < firstDate) continue;
    while (index < trades.length && String(trades[index].date).slice(0, 10) <= day.date) through.push(trades[index++]);
    const quantity = calculateHoldings(through)[ticker] || 0;
    const usd = calculateAssetMetrics(through, quantity * day.close);
    // Intentionally preserve the application's existing currency lens. No FX provider or rate changes.
    const ils = calculateAssetMetrics(through, quantity * day.close * exchangeRate, true);
    points.push({ date: day.date, usd: usd.netInvested > 0 ? usd.netProfit / usd.netInvested * 100 : null, ils: ils.netInvested > 0 ? ils.netProfit / ils.netInvested * 100 : null });
  }
  return { points, reason: null };
}

/** Euler allocation: w_i * Cov(r_i, r_portfolio) / Var(r_portfolio).
 * Uses current weights and dividend-adjusted daily returns, never changes in account value.
 * Align entire return intervals, rather than filling missing prices with zero returns.
 */
export function calculateRiskContribution(assets: { ticker: string; value: number }[], histories: Map<string, PriceHistory>, now = Date.now()): RiskContribution {
  const empty = (reason: string, observations = 0): RiskContribution => ({ rows: [], annualizedPortfolioVolatility: null, observations, from: null, through: null, reason });
  const active = assets.filter(asset => asset.value > 0);
  const total = active.reduce((sum, asset) => sum + asset.value, 0);
  if (!active.length || total <= 0) return empty("No active holdings.");
  const cutoff = new Date(now); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const start = cutoff.toISOString().slice(0, 10);
  const returns = active.map(asset => {
    const prices = histories.get(asset.ticker)?.prices || [];
    const series = new Map<string, number>();
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1], day = prices[i];
      if (prev.date < start || !(prev.adjustedClose > 0) || !(day.adjustedClose > 0)) continue;
      series.set(`${prev.date}/${day.date}`, day.adjustedClose / prev.adjustedClose - 1);
    }
    return series;
  });
  const intervals = Array.from(returns[0].keys()).filter(key => returns.every(series => series.has(key))).sort();
  if (intervals.length < 126) return empty("At least 126 shared daily returns within the last year are required for all active funds.", intervals.length);
  const through = intervals[intervals.length - 1].split("/")[1];
  if (now - Date.parse(through) > 7 * 86400000) return empty("The shared price history is out of date.", intervals.length);
  const weights = active.map(asset => asset.value / total);
  const matrix = returns.map(series => intervals.map(key => series.get(key)!));
  const portfolio = intervals.map((_, day) => weights.reduce((sum, weight, fund) => sum + weight * matrix[fund][day], 0));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const portfolioMean = mean(portfolio);
  const variance = portfolio.reduce((sum, value) => sum + (value - portfolioMean) ** 2, 0);
  // The same weighted daily series incorporates covariances. Do not average fund volatilities.
  const annualizedPortfolioVolatility = Math.sqrt(variance / (intervals.length - 1) * 252) * 100;
  const rows = active.map((asset, fund) => {
    const fundMean = mean(matrix[fund]);
    const fundVariance = matrix[fund].reduce((sum, value) => sum + (value - fundMean) ** 2, 0) / (intervals.length - 1);
    const covariance = portfolio.reduce((sum, value, day) => sum + (value - portfolioMean) * (matrix[fund][day] - fundMean), 0);
    return { ticker: asset.ticker, weight: weights[fund] * 100, contribution: variance < 1e-16 ? null : weights[fund] * covariance / variance * 100, annualizedVolatility: Math.sqrt(fundVariance * 252) * 100 };
  });
  return { rows, annualizedPortfolioVolatility, observations: intervals.length, from: intervals[0].split("/")[0], through, reason: null };
}

function companyId(holding: FundHolding) {
  const symbol = holding.symbol.toUpperCase().replace(/[ ./-]/g, "");
  // Explicit issuer aliases avoid merging unrelated symbols on different national exchanges.
  const aliases: Record<string, string> = { GOOG: "ALPHABET", GOOGL: "ALPHABET", BRKA: "BERKSHIRE", BRKB: "BERKSHIRE", FOX: "FOX", FOXA: "FOX", NWS: "NEWS", NWSA: "NEWS" };
  return `${holding.country.toUpperCase()}:${aliases[symbol] || symbol}`;
}

export function aggregateSectorCompanies(
  assets: { ticker: string; value: number }[],
  compositions: Map<string, FundComposition>,
): SectorCompanyExposure {
  const total = assets.reduce((sum, asset) => sum + Math.max(0, asset.value), 0);
  const groups = new Map<string, Map<string, SectorCompanyExposure["sectors"][string][number]>>();
  const incompleteTickers: string[] = [];
  for (const { ticker, value } of assets) {
    if (!(value > 0) || ticker === "SGOV" || ticker === "IAU") continue;
    const holdings = compositions.get(ticker)?.holdings ?? [];
    if (!holdings.length || holdings.some(holding => holding.weight > 0 && !holding.sector)) {
      incompleteTickers.push(ticker);
    }
    for (const holding of holdings) {
      if (!holding.sector || !(holding.weight > 0)) continue;
      let companies = groups.get(holding.sector);
      if (!companies) {
        companies = new Map();
        groups.set(holding.sector, companies);
      }
      const id = companyId(holding);
      const company = companies.get(id) ?? { id, name: holding.name, weight: 0 };
      company.weight += value / total * holding.weight * 100;
      companies.set(id, company);
    }
  }
  const sectors = Object.fromEntries(Array.from(groups, ([sector, companies]) => [
    sector,
    Array.from(companies.values()).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, 5),
  ]));
  return { sectors, incompleteTickers };
}

export function aggregateCompanyExposure(assets: { ticker: string; value: number }[], compositions: Map<string, FundComposition>): CompanyExposure {
  const total = assets.reduce((sum, asset) => sum + Math.max(0, asset.value), 0);
  const companies = new Map<string, CompanyExposure["companies"][number]>();
  const missingTickers: string[] = [];
  let covered = 0, equity = 0;
  for (const asset of assets) {
    if (asset.value <= 0 || asset.ticker === "SGOV" || asset.ticker === "IAU") continue;
    equity += asset.value;
    const composition = compositions.get(asset.ticker);
    if (!composition) { missingTickers.push(asset.ticker); continue; }
    covered += asset.value * composition.equityWeight;
    for (const holding of composition.holdings) {
      const id = companyId(holding);
      const row = companies.get(id) || { id, name: holding.name, symbols: [], weight: 0, funds: [] };
      row.weight += total > 0 ? asset.value / total * holding.weight * 100 : 0;
      if (!row.funds.includes(asset.ticker)) row.funds.push(asset.ticker);
      if (!row.symbols.includes(holding.symbol)) row.symbols.push(holding.symbol);
      companies.set(id, row);
    }
  }
  return { companies: Array.from(companies.values()).sort((a, b) => b.weight - a.weight).slice(0, 20), sources: [], missingTickers, coveredPortfolioPct: total > 0 ? covered / total * 100 : 0, equityPortfolioPct: total > 0 ? equity / total * 100 : 0 };
}
