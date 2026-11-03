"use client";

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RiskContribution } from "@/lib/portfolio-analytics";

export function RiskContributionChart({ data, loading, error }: { data: RiskContribution | null; loading: boolean; error: string | null }) {
  return <section className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
    <h3 className="text-lg font-semibold text-white">What drives volatility?</h3>
    <p className="mt-1 text-sm text-slate-400">Portfolio weight vs. share of portfolio volatility</p>
    {loading && !data ? <p role="status" className="py-8 text-sm text-slate-400">Loading daily returns…</p> : error || !data || data.reason ? <p role="status" className="py-8 text-sm text-slate-400">{error || data?.reason || "Risk analysis is not available yet."}</p> : <>
      <div className="mt-5 h-64" role="img" aria-label="Each fund’s portfolio weight compared with its contribution to portfolio volatility">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 256 }}><BarChart data={data.rows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="ticker" tick={{ fill: "#cbd5e1", fontSize: 12 }} />
          <YAxis tickFormatter={value => `${Math.round(Number(value))}%`} tick={{ fill: "#94a3b8", fontSize: 11 }} width={48} />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <Tooltip cursor={{ fill: "#1e293b" }} formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name]} contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8, color: "#fff" }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
          <Bar dataKey="weight" name="Portfolio weight" fill="#8eabff" radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false} />
          <Bar dataKey="contribution" name="Volatility contribution" fill="#2dd4bf" radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false} />
        </BarChart></ResponsiveContainer>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-slate-400">Current portfolio weights · USD daily total returns · {data.from} – {data.through} · {data.observations} shared observations</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">Contributions include relationships between funds and sum to 100%. A negative contribution means a fund reduced portfolio volatility over this sample. Historical estimates, not a forecast.</p>
      <details className="mt-3 text-xs text-slate-400"><summary className="cursor-pointer">View exact percentages</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-2">Fund</th><th className="text-right">Weight</th><th className="text-right">Volatility contribution</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.ticker}><td className="py-1">{row.ticker}</td><td className="text-right">{row.weight.toFixed(2)}%</td><td className="text-right">{row.contribution.toFixed(2)}%</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
