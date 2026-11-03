"use client";

import type { RiskContribution } from "@/lib/portfolio-analytics";

type Props = {
  data: RiskContribution | null;
  returns: { ticker: string; profitPct: number | null }[];
  loading: boolean;
  error: string | null;
};

export function RiskContributionChart({ data, returns, loading, error }: Props) {
  const profits = new Map(returns.map(asset => [asset.ticker, asset.profitPct]));
  const rows = [...(data?.rows || [])].sort((a, b) => b.annualizedVolatility - a.annualizedVolatility);
  const maxVolatility = Math.max(1, ...rows.map(row => row.annualizedVolatility));
  const unavailable = error || data?.reason || (!data || !rows.length ? "Risk analysis is not available yet." : null);

  return <section className="mb-8 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
    <div className="px-5 pb-3 pt-5 sm:px-6">
      <h3 className="text-lg font-semibold text-white">Risk &amp; Return</h3>
      <p className="mt-1 text-xs text-slate-400">USD · Profit since first investment · Sorted by fund volatility</p>
    </div>

    {loading && !data ? <p role="status" className="px-6 py-8 text-sm text-slate-400">Loading daily returns…</p> : unavailable ? <p role="status" className="px-6 py-8 text-sm text-slate-400">{unavailable}</p> : <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950/30 text-[11px] text-slate-400 sm:text-xs"><tr>
            <th scope="col" className="px-4 py-2.5 font-medium sm:px-6">Fund</th>
            <th scope="col" className="px-2 py-2.5 text-right font-medium sm:px-4">Cumulative<br className="sm:hidden" /> profit</th>
            <th scope="col" className="px-2 py-2.5 text-right font-medium sm:px-4">Volatility<br className="sm:hidden" /> (1Y)</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-6">Relative<br className="sm:hidden" /> impact<span className="block text-[10px] font-normal text-slate-500">1× = average</span></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-800">{rows.map(row => {
            const profit = profits.get(row.ticker);
            const validProfit = profit != null && Number.isFinite(profit);
            const impact = row.weight > 0 ? row.contribution / row.weight : null;
            const impactTone = impact == null ? "text-slate-400" : impact < 0 ? "text-emerald-400" : impact > 1 ? "text-amber-300" : "text-sky-300";
            const impactText = impact == null ? "—" : impact < 0 ? "Offsets" : impact > 0 && impact < 0.01 ? "<0.01×" : `${impact.toFixed(2)}×`;
            return <tr key={row.ticker}>
              <th scope="row" className="px-4 py-3 font-semibold text-white sm:px-6">{row.ticker}</th>
              <td className={`px-2 py-3 text-right font-medium tabular-nums sm:px-4 ${!validProfit || profit === 0 ? "text-slate-300" : profit > 0 ? "text-emerald-400" : "text-red-400"}`}>{validProfit ? `${profit > 0 ? "+" : ""}${profit.toFixed(2)}%` : "—"}</td>
              <td className="px-2 py-3 text-right tabular-nums text-slate-200 sm:px-4">
                <span className="inline-flex items-center justify-end gap-2"><span className="relative hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-800 sm:block" aria-hidden="true"><span className="absolute inset-y-0 left-0 rounded-full bg-slate-400" style={{ width: `${row.annualizedVolatility / maxVolatility * 100}%` }} /></span>{row.annualizedVolatility.toFixed(1)}%</span>
              </td>
              <td className={`px-4 py-3 text-right font-medium tabular-nums sm:px-6 ${impactTone}`} title={impact == null ? "Unavailable" : impact < 0 ? `${impact.toFixed(2)}×: offsets portfolio volatility` : `${impact.toFixed(2)}× the portfolio-average volatility contribution per invested dollar`}>{impactText}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      <details className="border-t border-slate-800 px-5 py-3 text-xs leading-relaxed text-slate-400 sm:px-6">
        <summary className="cursor-pointer">How to read this &amp; calculation details</summary>
        <div className="mt-3 space-y-3">
          <p><strong className="text-slate-200">Cumulative profit</strong> is your recorded total profit divided by Net Invested for each fund, in USD, as in Assets. Green means a profit; red means a loss. It includes recorded realized gains and reinvested dividends. This is your result since investing, not the fund’s one-year market return.</p>
          <p><strong className="text-slate-200">Volatility (1Y)</strong> measures each fund’s own fluctuations: sample standard deviation of daily dividend-adjusted USD returns, annualized using 252 trading days. Higher values mean wider fluctuations in either direction. Low volatility does not imply a positive return or protection from losses.</p>
          <p><strong className="text-slate-200">Relative impact</strong> combines the two previous weight figures: share of portfolio volatility ÷ portfolio weight. <strong className="text-slate-200">1×</strong> is the portfolio average per invested dollar; <strong className="text-amber-300">2×</strong> means twice that contribution; <strong className="text-sky-300">0.5×</strong> means half. <strong className="text-emerald-400">Offsets</strong> means a negative contribution that dampened portfolio volatility in this sample. It includes how the funds move together; a high multiplier does not necessarily mean the largest absolute contribution to portfolio volatility. The original weights and contributions are below.</p>
          <p>Profit and volatility cover different periods and answer different questions. They are displayed together without combining them into a performance score. Relative impact is a contribution measure, not a probability of loss or a forecast.</p>
          <p>Current portfolio weights · Daily USD total returns · {data!.from} – {data!.through} · {data!.observations} shared observations. Profit uses the latest portfolio valuation; volatility uses daily closing observations.</p>
          <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2 font-medium">Fund</th><th className="text-right font-medium">Weight</th><th className="text-right font-medium">Volatility share</th><th className="text-right font-medium">Impact</th></tr></thead><tbody>{rows.map(row => <tr key={row.ticker}><td className="py-1">{row.ticker}</td><td className="text-right tabular-nums">{row.weight.toFixed(2)}%</td><td className="text-right tabular-nums">{row.contribution.toFixed(2)}%</td><td className="text-right tabular-nums">{row.weight > 0 ? `${(row.contribution / row.weight).toFixed(2)}×` : "—"}</td></tr>)}</tbody></table></div>
        </div>
      </details>
    </>}
  </section>;
}
