"use client";

import type { RiskContribution } from "@/lib/portfolio-analytics";
import { RiskReturnScatter, type RiskReturnPoint } from "./risk-return-scatter";

type Props = {
  data: RiskContribution | null;
  returns: { ticker: string; profitPct: number | null }[];
  totalProfitPct: number | null;
  loading: boolean;
  error: string | null;
};

export function RiskContributionChart({ data, returns, totalProfitPct, loading, error }: Props) {
  const profits = new Map(returns.map(asset => [asset.ticker, asset.profitPct]));
  const rows = [...(data?.rows || [])].sort((a, b) => b.annualizedVolatility - a.annualizedVolatility);
  const totalVolatility = data?.annualizedPortfolioVolatility ?? null;
  const unavailable = error || data?.reason || (!data || !rows.length ? "Risk analysis is not available yet." : null);
  const points: RiskReturnPoint[] = rows.flatMap(row => {
    const profit = profits.get(row.ticker);
    return profit != null && Number.isFinite(profit) ? [{ id: row.ticker, name: row.ticker, profitPct: profit, volatility: row.annualizedVolatility, weight: row.weight, isPortfolio: false }] : [];
  });
  if (totalProfitPct != null && Number.isFinite(totalProfitPct) && totalVolatility != null && Number.isFinite(totalVolatility)) {
    points.push({ id: "total-portfolio", name: "Portfolio", profitPct: totalProfitPct, volatility: totalVolatility, weight: 100, isPortfolio: true });
  }

  return <section className="mb-8 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
    <div className="px-5 pb-3 pt-5 sm:px-6">
      <h3 className="text-lg font-semibold text-white">Risk &amp; Return</h3>
      <p className="mt-1 text-xs text-slate-400">USD · All-time profit · 1Y volatility</p>
    </div>

    {loading && !data ? <p role="status" className="px-6 py-8 text-sm text-slate-400">Loading daily returns…</p> : unavailable ? <p role="status" className="px-6 py-8 text-sm text-slate-400">{unavailable}</p> : (
      <RiskReturnScatter points={points} />
    )}
  </section>;
}
