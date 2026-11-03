"use client";

import { useState } from "react";
import type { CompanyExposure as Exposure } from "@/lib/portfolio-analytics";

export function CompanyExposure({ data, loading, error }: { data: Exposure | null; loading: boolean; error: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const companies = data?.companies.slice(0, expanded ? 20 : 10) || [];
  const topWeight = companies.reduce((sum, row) => sum + row.weight, 0);
  const partial = Boolean(data?.missingTickers.length);
  return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 p-6">
      <div><h3 className="text-lg font-semibold text-white">Companies you own</h3><p className="mt-1 text-sm text-slate-400">Largest underlying company exposures · % of your entire portfolio</p></div>
      {data && data.companies.length > 10 && <button type="button" aria-expanded={expanded} aria-controls="company-exposure-table" onClick={() => setExpanded(value => !value)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">{expanded ? "Show 10" : "Show 20"}</button>}
    </div>
    {loading && !data ? <p role="status" className="p-6 text-sm text-slate-400">Loading full fund holdings…</p> : error || !companies.length ? <p role="status" className="p-6 text-sm text-slate-400">{error || "Company holdings are not available yet. They refresh automatically with market sync."}</p> : <>
      {partial && <p className="px-6 pt-4 text-sm text-amber-400">Partial ranking: holdings unavailable for {data!.missingTickers.join(", ")}. These funds are included in the portfolio denominator.</p>}
      <div id="company-exposure-table" className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th className="px-6 py-3 font-medium">Company</th><th className="px-6 py-3 font-medium">Held through</th><th className="px-6 py-3 text-right font-medium">Portfolio weight</th></tr></thead><tbody className="divide-y divide-slate-800">{companies.map(company => <tr key={company.id}>
        <td className="px-6 py-3"><p className="font-medium text-white">{company.name}</p><p className="mt-0.5 text-xs text-slate-500">{company.symbols.join(" / ")}</p></td>
        <td className="px-6 py-3 text-slate-400">{company.funds.join(" · ")}</td><td className="px-6 py-3 text-right font-medium tabular-nums text-slate-200">{company.weight.toFixed(2)}%</td>
      </tr>)}</tbody></table></div>
      <div className="border-t border-slate-800 px-6 py-4 text-sm text-slate-300">{partial ? "Listed" : "Top"} {companies.length} companies: <strong>{topWeight.toFixed(2)}%</strong> of your entire portfolio</div>
    </>}
    {data && <div className="border-t border-slate-800 px-6 py-4 text-xs leading-relaxed text-slate-500">
      <p>SGOV and IAU remain in the portfolio total and are excluded from the company list. Share classes are combined where identified.</p>
      <p className="mt-1">Equity holdings mapped: {data.coveredPortfolioPct.toFixed(1)}% of the portfolio · Equity funds: {data.equityPortfolioPct.toFixed(1)}%.</p>
      <p className="mt-2">Fund holdings refresh automatically each week; portfolio weights update with your portfolio.</p>
      {data.sources.map(source => <p key={source.ticker} className={source.stale ? "mt-1 text-amber-400" : "mt-1"}>{source.ticker} · {source.source} · Holdings as of {source.asOf} · Retrieved {source.refreshedAt.slice(0, 10)}{source.stale ? " · Refresh overdue; showing last valid data" : ""}</p>)}
    </div>}
  </section>;
}
