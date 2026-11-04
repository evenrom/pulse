"use client";

import type { RiskContribution } from "@/lib/portfolio-analytics";
import { classifyVolatility, formatVolatility, VOLATILITY_BANDS, VOLATILITY_SOURCE } from "@/lib/volatility";
import { RiskReturnScatter, type RiskReturnPoint } from "./risk-return-scatter";

type Props = {
  data: RiskContribution | null;
  returns: { ticker: string; profitPct: number | null }[];
  totalProfitPct: number | null;
  loading: boolean;
  error: string | null;
};

function ProfitCell({ value, total = false }: { value: number | null | undefined; total?: boolean }) {
  const valid = value != null && Number.isFinite(value);
  const tone = !valid || value === 0 ? "text-slate-300" : value > 0 ? "text-emerald-400" : "text-red-400";
  return <td className={`px-2 py-3 text-right tabular-nums sm:px-4 ${total ? "font-semibold" : "font-medium"} ${tone}`}>{valid ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—"}</td>;
}

function VolatilityCell({ value, maximum }: { value: number | null; maximum: number }) {
  const band = classifyVolatility(value);
  return <td className="px-2 py-3 text-right tabular-nums sm:px-4">
    {band && value != null ? <div className="ml-auto flex w-24 flex-col gap-1">
      <div className="flex items-baseline justify-end gap-1.5"><span className="text-slate-200">{formatVolatility(value)}</span><span className={`text-[10px] ${band.textClass}`}>{band.label}</span></div>
      <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-800" aria-hidden="true"><span className={`absolute inset-y-0 left-0 rounded-full ${band.barClass}`} style={{ width: `${value / maximum * 100}%` }} /></span>
    </div> : <span className="text-slate-400">—</span>}
  </td>;
}

export function RiskContributionChart({ data, returns, totalProfitPct, loading, error }: Props) {
  const profits = new Map(returns.map(asset => [asset.ticker, asset.profitPct]));
  const rows = [...(data?.rows || [])].sort((a, b) => b.annualizedVolatility - a.annualizedVolatility);
  const totalVolatility = data?.annualizedPortfolioVolatility ?? null;
  const maxVolatility = Math.max(1, totalVolatility ?? 0, ...rows.map(row => row.annualizedVolatility));
  const unavailable = error || data?.reason || (!data || !rows.length ? "Risk analysis is not available yet." : null);
  const points: RiskReturnPoint[] = rows.flatMap(row => {
    const profit = profits.get(row.ticker);
    return profit != null && Number.isFinite(profit) ? [{ id: row.ticker, name: row.ticker, profitPct: profit, volatility: row.annualizedVolatility, weight: row.weight, isPortfolio: false }] : [];
  });
  if (totalProfitPct != null && Number.isFinite(totalProfitPct) && totalVolatility != null && Number.isFinite(totalVolatility)) {
    points.push({ id: "total-portfolio", name: "Total Portfolio", profitPct: totalProfitPct, volatility: totalVolatility, weight: 100, isPortfolio: true });
  }

  return <section className="mb-8 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
    <div className="px-5 pb-3 pt-5 sm:px-6">
      <h3 className="text-lg font-semibold text-white">Risk &amp; Return</h3>
      <p className="mt-1 text-xs text-slate-400">USD · Cumulative profit since investing · Volatility from a shared trailing-year sample</p>
    </div>

    {loading && !data ? <p role="status" className="px-6 py-8 text-sm text-slate-400">Loading daily returns…</p> : unavailable ? <p role="status" className="px-6 py-8 text-sm text-slate-400">{unavailable}</p> : <>
      <div className="grid min-w-0 xl:grid-cols-2">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Portfolio and funds: your cumulative USD profit, annualized volatility and relative volatility contribution. Fund rows sorted by volatility.</caption>
            <thead className="bg-slate-950/30 text-[11px] text-slate-400 sm:text-xs"><tr>
              <th scope="col" className="px-4 py-2.5 font-medium sm:px-6">Fund</th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium sm:px-4">Cumulative<br className="sm:hidden" /> profit</th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium sm:px-4">Volatility<br className="sm:hidden" /> (1Y)</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-6">Relative<br className="sm:hidden" /> impact<span className="block text-[10px] font-normal text-slate-500">1× = average</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800">
              <tr className="border-y border-slate-700 bg-slate-800/60">
                <th scope="row" className="px-4 py-3 font-semibold text-white sm:px-6">Total Portfolio</th>
                <ProfitCell value={totalProfitPct} total />
                <VolatilityCell value={totalVolatility} maximum={maxVolatility} />
                <td aria-label="Relative impact does not apply to the whole portfolio" />
              </tr>
              {rows.map(row => {
                const impact = row.weight > 0 && row.contribution != null ? row.contribution / row.weight : null;
                const impactTone = impact == null ? "text-slate-400" : impact < 0 ? "text-emerald-400" : impact > 1 ? "text-amber-300" : "text-sky-300";
                const impactText = impact == null ? "—" : impact < 0 ? "Offsets" : impact > 0 && impact < 0.01 ? "<0.01×" : `${impact.toFixed(2)}×`;
                return <tr key={row.ticker}>
                  <th scope="row" className="px-4 py-3 font-semibold text-white sm:px-6">{row.ticker}</th>
                  <ProfitCell value={profits.get(row.ticker)} />
                  <VolatilityCell value={row.annualizedVolatility} maximum={maxVolatility} />
                  <td className={`px-4 py-3 text-right font-medium tabular-nums sm:px-6 ${impactTone}`} title={impact == null ? "Unavailable: portfolio volatility is too small to allocate reliably" : impact < 0 ? `${impact.toFixed(2)}×: offsets portfolio volatility` : `${impact.toFixed(2)}× the portfolio-average volatility contribution per invested dollar`}>{impactText}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="min-w-0 border-t border-slate-800 xl:border-l xl:border-t-0"><RiskReturnScatter points={points} /></div>
      </div>

      <details className="border-t border-slate-800 px-5 py-3 text-xs leading-relaxed text-slate-400 sm:px-6">
        <summary className="cursor-pointer">How to read this &amp; calculation details</summary>
        <div className="mt-3 space-y-3">
          <p><strong className="text-slate-200">Cumulative profit</strong> is your recorded total USD profit divided by Net Invested, as in Assets and Portfolio Profit. Green means a profit; red means a loss. It includes recorded realized gains and reinvested dividends. Each fund’s starting date may differ; the Total Portfolio profit is computed from the whole portfolio, not an average of fund percentages.</p>
          <p><strong className="text-slate-200">Volatility (1Y)</strong> measures the size of fluctuations in either direction: sample standard deviation of daily dividend-adjusted USD returns, annualized using 252 trading days. All funds and the portfolio use the same shared observations. At least 126 daily returns are required within the last year; this can be a shorter sample than a full year.</p>
          <p><strong className="text-slate-200">Total Portfolio volatility</strong> is the annualized sample standard deviation of the current-weighted daily portfolio returns. This incorporates correlations and covariance between funds; it is not a simple or weighted average of their individual volatilities. It describes today’s allocation over this historical sample, not every change in your actual past allocation.</p>
          <div><p className="font-medium text-slate-200">Pulse volatility display bands</p><ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">{VOLATILITY_BANDS.map(band => <li key={band.key} className={band.textClass}>{band.label}: {band.range} annualized volatility</li>)}</ul></div>
          <p>These are Pulse display conventions, not universal thresholds or a suitability assessment. The 5% and 15% boundaries group the lower three, middle two and upper two intervals in the historical <a href={VOLATILITY_SOURCE} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline">CESR/10-673 volatility grid, Box 2</a>. This provides fixed, interpretable reference points without re-ranking funds whenever your holdings change. Pulse is not an official SRRI or PRIIPs rating: that historical methodology uses five years of weekly (or monthly) returns, while Pulse uses the daily trailing-year sample above. Classification uses unrounded values; a value just below a boundary is shown as &lt;5.0% or &lt;15.0% if needed to avoid misleading rounding.</p>
          <p>The category does not determine whether the risk is suitable for you personally. Low volatility does not mean “safe” or guarantee a positive return: a low-volatility fund can lose money. Volatility colors (blue, amber, purple) are separate from profit/loss colors (green, red). These are historical estimates, not a forecast or probability of loss.</p>
          <p><strong className="text-slate-200">Relative impact</strong> is share of portfolio volatility ÷ portfolio weight. 1× is the portfolio average per invested dollar; 2× means twice that contribution; 0.5× means half. “Offsets” means a negative contribution that dampened portfolio volatility. A high multiplier need not be the largest absolute contribution. It is undefined if portfolio volatility is effectively zero and does not apply to Total Portfolio.</p>
          <p><strong className="text-slate-200">Scatter plot</strong>: farther right means greater historical volatility; above or below the zero-profit line means your cumulative gain or loss. Select, hover or keyboard-focus a point to inspect it. Diamonds identify the portfolio; circles identify funds, with approximate area proportional to current weight (a minimum size keeps tiny holdings selectable). Labels move to reduce overlap; data points keep their exact coordinates.</p>
          <p>Profit and volatility cover different periods. This is a descriptive comparison, not an efficiency score or investment ranking. Current-weight risk sample: {data!.from} – {data!.through} · {data!.observations} shared daily returns · USD. Profit uses the latest portfolio valuation; volatility uses completed daily closing observations.</p>
          <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2 font-medium">Fund</th><th className="text-right font-medium">Weight</th><th className="text-right font-medium">Volatility share</th><th className="text-right font-medium">Impact</th></tr></thead><tbody>{rows.map(row => <tr key={row.ticker}><td className="py-1">{row.ticker}</td><td className="text-right tabular-nums">{row.weight.toFixed(2)}%</td><td className="text-right tabular-nums">{row.contribution == null ? "—" : `${row.contribution.toFixed(2)}%`}</td><td className="text-right tabular-nums">{row.weight > 0 && row.contribution != null ? `${(row.contribution / row.weight).toFixed(2)}×` : "—"}</td></tr>)}</tbody></table></div>
        </div>
      </details>
    </>}
  </section>;
}
