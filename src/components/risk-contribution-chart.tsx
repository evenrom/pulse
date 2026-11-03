"use client";

import type { RiskContribution } from "@/lib/portfolio-analytics";

type Props = { data: RiskContribution | null; loading: boolean; error: string | null };

function percentage(value: number) {
  return `${value.toFixed(1)}%`;
}

export function RiskContributionChart({ data, loading, error }: Props) {
  const rows = [...(data?.rows || [])].sort((a, b) => b.contribution - a.contribution);
  const largest = rows[0];
  // Shared, signed axis: negative hedges and contributions above 100% stay visible.
  const minimum = Math.min(0, Math.floor(Math.min(0, ...rows.map(row => row.contribution)) / 10) * 10);
  const maximum = Math.max(10, Math.ceil(Math.max(0, ...rows.flatMap(row => [row.weight, row.contribution])) / 10) * 10);
  const position = (value: number) => (value - minimum) / (maximum - minimum) * 100;
  const unavailable = error || data?.reason || (!data || !rows.length ? "Risk analysis is not available yet." : null);

  return <section className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
    <h3 className="text-lg font-semibold text-white">Portfolio Risk</h3>
    <p className="mt-1 text-sm text-slate-400">Where portfolio volatility comes from</p>

    {loading && !data ? <p role="status" className="py-8 text-sm text-slate-400">Loading daily returns…</p> : unavailable ? <p role="status" className="py-8 text-sm text-slate-400">{unavailable}</p> : <>
      {largest && <div className="mt-5 rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
        <p className="text-sm leading-relaxed text-slate-300"><strong className="text-white">{largest.ticker}</strong> is the largest contributor: <strong className="text-white">{percentage(largest.contribution)}</strong> of volatility from <strong className="text-white">{percentage(largest.weight)}</strong> of your portfolio.</p>
      </div>}

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-5 rounded-sm bg-slate-400" aria-hidden="true" />Share of volatility</span>
        <span className="inline-flex items-center gap-2"><span className="h-3 w-0.5 bg-white" aria-hidden="true" />Portfolio weight</span>
      </div>

      <ul className="mt-2 divide-y divide-slate-800">
        {rows.map(row => {
          const difference = row.contribution - row.weight;
          const offsets = row.contribution < 0;
          const aboveWeight = difference > 0;
          const tone = offsets ? "text-emerald-400" : aboveWeight ? "text-amber-300" : "text-sky-300";
          const barTone = offsets ? "bg-emerald-400" : aboveWeight ? "bg-amber-400" : "bg-sky-400";
          const interpretation = offsets ? "Offsets portfolio volatility" : Math.abs(difference) < 0.1 ? "In line with portfolio weight" : aboveWeight ? "Above its portfolio weight" : "Below its portfolio weight";

          return <li key={row.ticker} className="py-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-semibold text-white">{row.ticker}</span><span className="text-xs text-slate-500">{percentage(row.weight)} of portfolio</span></div>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${tone}`}>{percentage(row.contribution)}<span className="ml-1 font-normal text-slate-400">of volatility</span></span>
            </div>

            <div className="relative mt-3 h-5" role="img" aria-label={`${row.ticker}: ${percentage(row.weight)} of the portfolio, ${percentage(row.contribution)} of portfolio volatility. ${interpretation}.`}>
              <div className="absolute inset-x-0 top-1.5 h-2 rounded-sm bg-slate-800" />
              <div className={`absolute top-1.5 h-2 rounded-sm ${barTone}`} style={{ left: `${position(Math.min(0, row.contribution))}%`, width: `${Math.abs(row.contribution) / (maximum - minimum) * 100}%` }} />
              {minimum < 0 && <span className="absolute inset-y-0 border-l border-dashed border-slate-500" style={{ left: `${position(0)}%` }} aria-hidden="true" />}
              <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded bg-white" style={{ left: `${position(row.weight)}%` }} aria-hidden="true" />
            </div>
            <p className={`mt-1 text-xs ${tone}`}>{interpretation}</p>
          </li>;
        })}
      </ul>

      <div className="relative h-5 text-[10px] tabular-nums text-slate-500" aria-hidden="true">
        <span className="absolute left-0">{minimum}%</span>
        {minimum < 0 && <span className="absolute -translate-x-1/2" style={{ left: `${position(0)}%` }}>0%</span>}
        <span className="absolute right-0">{maximum}%</span>
      </div>

      <details className="mt-3 border-t border-slate-800 pt-4 text-xs text-slate-400">
        <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">How to read this &amp; calculation details</summary>
        <div className="mt-3 space-y-3 leading-relaxed">
          <p>The colored bar is a fund’s share of portfolio volatility. The white marker is its portfolio weight. A bar extending beyond the marker means the fund contributes more volatility than its share of the money invested.</p>
          <p>Amber means above portfolio weight; blue means below portfolio weight. Below weight does not mean a fund removes risk. Only a negative contribution, shown in green to the left of zero, offsets portfolio volatility in this sample.</p>
          <p>This measures how the portfolio fluctuates, not the probability of losing money or every type of investment risk. The chart explains where volatility comes from; it does not score your portfolio’s overall risk level.</p>
          <p>Current portfolio weights · USD daily total returns · {data!.from} – {data!.through} · {data!.observations} shared observations.</p>
          <p>Contributions include relationships between funds and sum to 100% before rounding. A contribution can exceed 100% when other funds offset it. These are historical estimates for the current allocation, not a forecast.</p>
          <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2 font-medium">Fund</th><th className="text-right font-medium">Weight</th><th className="text-right font-medium">Volatility share</th></tr></thead><tbody>{rows.map(row => <tr key={row.ticker}><td className="py-1">{row.ticker}</td><td className="text-right tabular-nums">{row.weight.toFixed(2)}%</td><td className="text-right tabular-nums">{row.contribution.toFixed(2)}%</td></tr>)}</tbody></table></div>
        </div>
      </details>
    </>}
  </section>;
}
