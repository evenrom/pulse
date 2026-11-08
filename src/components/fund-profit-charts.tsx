"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PortfolioAnalytics } from "@/lib/portfolio-analytics";
const FUND_COLORS = ["#8eabff", "#2dd4bf", "#c4b5fd", "#fbbf24", "#fb7185"];

export type ProfitPeriod = "1M" | "1Q" | "1Y" | "ALL";
export function periodCutoff(period: ProfitPeriod, now = new Date()) {
  const cutoff = new Date(now);
  if (period === "1M") cutoff.setMonth(cutoff.getMonth() - 1);
  else if (period === "1Q") cutoff.setMonth(cutoff.getMonth() - 3);
  else if (period === "1Y") cutoff.setFullYear(cutoff.getFullYear() - 1);
  else return "0000-01-01";
  return cutoff.toISOString().slice(0, 10);
}

type Props = { data: PortfolioAnalytics | null; currency: "usd" | "ils"; period: ProfitPeriod; loading: boolean; error: string | null };

export function FundProfitCharts({ data, currency, period, loading, error }: Props) {
  const [expanded, setExpanded] = useState(false);
  const funds = useMemo(() => {
    const cutoff = periodCutoff(period);
    return (data?.funds || []).map(fund => ({ ...fund, points: fund.points.filter(point => point.date >= cutoff).map(point => ({ date: point.date, value: point[currency] })) }));
  }, [data, period, currency]);
  const dates = funds.flatMap(fund => fund.points.map(point => Date.parse(point.date)));
  const values = funds.flatMap(fund => fund.points.flatMap(point => point.value == null ? [] : [Math.abs(point.value)]));
  const bound = Math.max(1, Math.ceil(Math.max(1, ...values) * 1.1));
  const xDomain: [number, number] = dates.length ? [Math.min(...dates), Math.max(...dates)] : [0, 1];

  return <section className="mb-8">
    <button type="button" aria-expanded={expanded} aria-controls="fund-profit-details" onClick={() => setExpanded(value => !value)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
      {expanded ? "Hide fund breakdown" : "Show fund breakdown"} <span aria-hidden="true">{expanded ? "−" : "+"}</span>
    </button>
    {expanded && <div id="fund-profit-details" className="mt-4">
      <p className="mb-4 text-sm text-slate-400">Profit since your first investment · Zero = each fund’s Net Invested · Shared scales · Daily closing prices</p>
      {currency === "ils" && <p className="mb-4 text-xs text-slate-500">Uses the same currency lens as Portfolio Profit: current USD/ILS with transaction-date costs.</p>}
      {loading && !data ? <p role="status" className="text-sm text-slate-400">Loading fund history…</p> : error ? <p role="status" className="text-sm text-amber-400">{error}</p> : !funds.length ? <p className="text-sm text-slate-400">No active funds.</p> :
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{funds.map((fund, index) => {
          const latest = fund.points.at(-1)?.value;
          return <article key={fund.ticker} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-1 flex items-center justify-between"><h3 className="font-semibold text-white">{fund.ticker}</h3><span className={latest == null ? "text-slate-400" : latest >= 0 ? "text-emerald-400" : "text-red-400"}>{latest == null ? "—" : `${latest >= 0 ? "+" : ""}${latest.toFixed(2)}%`}</span></div>
            <p className="mb-3 text-xs text-slate-500">{fund.through ? `Close ${fund.through}${fund.stale ? " · Outdated" : ""}` : "Awaiting history"}</p>
            {fund.reason || !fund.points.length ? <p className="flex h-44 items-center text-sm text-slate-400">{fund.reason || "No observations in this period."}</p> :
              <div className="pulse-chart h-44" role="img" aria-label={`${fund.ticker} profit percentage, zero equals its net invested capital`}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 300, height: 176 }}><AreaChart data={fund.points.map(point => ({ ...point, timestamp: Date.parse(point.date) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="timestamp" type="number" scale="time" domain={xDomain} tickFormatter={value => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} minTickGap={35} />
                  <YAxis domain={[-bound, bound]} ticks={[-bound, -bound / 2, 0, bound / 2, bound]} tickFormatter={value => `${Number(value).toFixed(0)}%`} tick={{ fontSize: 10, fill: "var(--chart-tick)" }} width={44} />
                  <ReferenceLine y={0} stroke="var(--chart-zero)" />
                  <Tooltip labelFormatter={value => new Date(Number(value)).toLocaleDateString("en-US", { timeZone: "UTC" })} formatter={value => [`${Number(value).toFixed(2)}%`, "Profit"]} contentStyle={{ background: "var(--chart-well)", border: "1px solid var(--chart-grid)", borderRadius: 8, color: "#fff" }} />
                  <Area type="linear" dataKey="value" stroke={FUND_COLORS[index % FUND_COLORS.length]} fill={FUND_COLORS[index % FUND_COLORS.length]} fillOpacity={0.15} baseValue={0} connectNulls={false} isAnimationActive={false} />
                </AreaChart></ResponsiveContainer>
              </div>}
          </article>;
        })}</div>}
    </div>}
  </section>;
}
