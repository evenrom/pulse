import { NextResponse } from "next/server";
import { db } from "@/db";
import { assets, transactions } from "@/db/schema";
import { validatePin } from "@/lib/auth";
import { calculateHoldings } from "@/lib/finance";
import { analyticsStartDate, HOLDINGS_REFRESH_MS, readAnalyticsCache, refreshAnalyticsCache } from "@/lib/analytics-cache";
import { aggregateCompanyExposure, aggregateSectorCompanies, buildFundProfitHistory, calculateRiskContribution, type FundComposition, type PortfolioAnalytics, type PriceHistory } from "@/lib/portfolio-analytics";
import { aggregateRegionalAllocation } from "@/lib/allocation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store, max-age=0, must-revalidate" };

export async function GET(request: Request) {
  const pin = request.headers.get("x-pin");
  if (!pin || !validatePin(pin)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const [allAssets, allTxs] = await Promise.all([db.select().from(assets), db.select().from(transactions)]);
    const quantities = calculateHoldings(allTxs);
    const active = allAssets.filter(asset => (quantities[asset.ticker] || 0) > 0);
    const start = analyticsStartDate(allTxs.map(tx => tx.date));
    await refreshAnalyticsCache(db, active.map(asset => asset.ticker), start);
    const cache = await readAnalyticsCache(db);
    const histories = new Map<string, PriceHistory>();
    const compositions = new Map<string, FundComposition>();
    const warnings: string[] = [];
    for (const asset of active) {
      const price = cache.get(`prices:v1:${asset.ticker}`);
      const holdings = cache.get(`holdings:v1:${asset.ticker}`);
      if (price?.payload) histories.set(asset.ticker, price.payload as PriceHistory);
      else warnings.push(`Daily prices unavailable for ${asset.ticker}.`);
      if (holdings?.payload) compositions.set(asset.ticker, holdings.payload as FundComposition);
    }
    // Reuse the current portfolio lens supplied by the client; this endpoint never fetches or stores FX.
    const suppliedRate = Number(new URL(request.url).searchParams.get("exchangeRate"));
    const exchangeRate = Number.isFinite(suppliedRate) && suppliedRate > 0 && suppliedRate < 100 ? suppliedRate : null;
    const funds: PortfolioAnalytics["funds"] = active.map(asset => {
      const history = histories.get(asset.ticker);
      if (!history) return { ticker: asset.ticker, points: [], through: null, stale: true, reason: "Daily prices are not available yet. Try market sync again later." };
      const result = buildFundProfitHistory(asset.ticker, allTxs, history, exchangeRate || 1);
      if (!exchangeRate) result.points.forEach(point => { point.ils = null; });
      const through = history.prices.at(-1)?.date || null;
      return { ticker: asset.ticker, ...result, through, stale: !through || Date.now() - Date.parse(through) > 7 * 86400000 };
    });
    const values = active.map(asset => ({ ticker: asset.ticker, value: (quantities[asset.ticker] || 0) * (asset.current_price || 0) }));
    const exposure = aggregateCompanyExposure(values, compositions);
    const sectorCompanies = aggregateSectorCompanies(values, compositions);
    exposure.sources = active.flatMap(asset => {
      const entry = cache.get(`holdings:v1:${asset.ticker}`);
      const composition = compositions.get(asset.ticker);
      return entry?.refreshed_at && composition ? [{ ticker: asset.ticker, source: composition.source, asOf: composition.asOf, refreshedAt: entry.refreshed_at, stale: Date.now() - Date.parse(entry.refreshed_at) >= HOLDINGS_REFRESH_MS }] : [];
    });
    const risk = calculateRiskContribution(values, histories);
    const regional = aggregateRegionalAllocation(values, compositions);
    regional.sources = exposure.sources.map(source => ({ ...source, basis: compositions.get(source.ticker)?.geography?.basis || (source.source === "iShares" ? "holdings" : "unavailable") }));
    if (active.some(asset => !(Number(asset.current_price) > 0))) { risk.rows = []; risk.annualizedPortfolioVolatility = null; risk.reason = "Current prices are missing for one or more holdings."; }
    return NextResponse.json({ funds, risk, exposure, sectorCompanies, regional, warnings } satisfies PortfolioAnalytics, { headers });
  } catch (error) {
    console.error("Portfolio analytics error:", error);
    return NextResponse.json({ error: "Analytics are temporarily unavailable. Your portfolio is still available." }, { status: 503, headers });
  }
}
