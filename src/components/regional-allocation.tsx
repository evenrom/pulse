"use client";

import { useState } from "react";
import { hasMaterialCountryGap } from "@/lib/allocation";
import type { RegionalAllocation as RegionalData } from "@/lib/allocation";

function percent(value: number) { return value > 0 && value < 0.05 ? "<0.1%" : `${value.toFixed(1)}%`; }
function detailPercent(value: number) { return value > 0 && value < 0.005 ? "<0.01%" : `${value.toFixed(2)}%`; }

export function RegionalAllocation({ data, loading, error }: { data: RegionalData | null; loading: boolean; error: string | null }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [showAllCountries, setShowAllCountries] = useState<Set<string>>(new Set());
  const countries = data?.regions.flatMap(region => region.countries) || [];
  const selected = countries.find(country => country.name === selectedCountry);
  const maximum = Math.max(10, Math.ceil(Math.max(0, ...(data?.regions || []).map(region => region.pct)) / 10) * 10);
  const toggle = (name: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  const residualRows = data ? [
    { name: "Cash & non-equity holdings", rows: data.residuals.nonEquity },
    { name: "Reporting / rounding differences", rows: data.residuals.reportingGap },
    { name: "Missing countries", rows: data.residuals.missingCountries },
  ].filter(group => group.rows.length > 0) : [];

  return <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
    <div className="px-5 pb-2 pt-5 sm:px-6"><h3 className="text-lg font-semibold text-white">Regional Split</h3><p className="mt-1 text-xs text-slate-400">Equity funds{data ? ` · ${percent(data.equityPortfolioPct)} of portfolio` : " · Country-based allocation"}</p>
      {!!data?.fundScopeTickers.length && <p className="mt-2 text-[11px] text-slate-500">{data.fundScopeTickers.join(", ")}: fund market classification · Details below</p>}
      {data && hasMaterialCountryGap(data) && <p role="status" className="mt-2 text-xs text-amber-400">{data.missingTickers.length ? `Country data unavailable for ${data.missingTickers.join(", ")}` : "Country coverage is incomplete"} · Details below</p>}
    </div>
    <div className="px-5 py-3 sm:px-6">
      {loading && !data ? <p role="status" className="py-8 text-sm text-slate-400">Loading fund countries…</p> : error || !data ? <p role="status" className="py-8 text-sm text-slate-400">{error || "Regional data are not available yet."}</p> : !data.regions.length ? <p className="py-8 text-sm text-slate-400">{data.equityPortfolioPct > 0 ? "No mapped country allocation available. See details below." : "No equity funds in the portfolio."}</p> : <>
        <div className="mb-3 flex items-center justify-between text-[10px] text-slate-500"><span>Share of equity funds</span><span>Scale 0–{maximum}%</span></div>
        <div className="space-y-5">{data.regions.map((region, index) => {
          const open = expanded.has(region.name);
          return <div key={region.name}>
            <button type="button" aria-expanded={open} aria-controls={`region-countries-${index}`} onClick={() => toggle(region.name)} className="block w-full text-left">
              <span className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-100"><span className="mr-1 inline-block w-3 text-slate-500" aria-hidden="true">{open ? "⌄" : "›"}</span>{region.name}</span><span className="font-semibold tabular-nums text-white">{percent(region.pct)}</span></span>
              <span className="block h-4 overflow-hidden rounded bg-slate-800/70"><span className={`block h-full rounded ${open ? "bg-blue-400" : "bg-blue-400/80"}`} style={{ width: `${region.pct / maximum * 100}%` }} /></span>
            </button>
            {open && <div id={`region-countries-${index}`} className="ml-2 mt-3 space-y-3 border-l border-slate-700 pl-3">{region.countries.slice(0, showAllCountries.has(region.name) ? undefined : 5).map(country => <button key={country.name} type="button" onClick={() => setSelectedCountry(country.name)} aria-pressed={selected?.name === country.name} className="block w-full text-left">
              <span className="mb-1 flex items-baseline justify-between gap-3 text-xs"><span className={selected?.name === country.name ? "text-white underline underline-offset-2" : "text-slate-300"}>{country.name}</span><span className="tabular-nums text-slate-300">{percent(country.pct)}</span></span>
              <span className="block h-1.5 rounded bg-slate-800/70"><span className="block h-full rounded bg-blue-300" style={{ width: `${country.pct / maximum * 100}%` }} /></span>
            </button>)}{region.countries.length > 5 && <button type="button" className="text-xs text-sky-300 hover:underline" onClick={() => setShowAllCountries(previous => { const next = new Set(previous); if (next.has(region.name)) next.delete(region.name); else next.add(region.name); return next; })}>{showAllCountries.has(region.name) ? "Show top 5 countries" : `Show all ${region.countries.length} countries`}</button>}</div>}
          </div>;
        })}</div>
        {selected && <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/30 px-4 py-3" role="status"><p className="text-sm font-semibold text-slate-100">{selected.name} · {percent(selected.pct)} of equity funds</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">{selected.contributions.map(item => <span key={item.ticker}>{item.ticker} {percent(item.pct)}</span>)}</div></div>}
      </>}
      {!!data?.outsideEquities.length && <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/30 px-4 py-3"><p className="text-sm font-semibold text-white">Outside equities</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">{data.outsideEquities.map(item => <span key={item.ticker}>{item.ticker} {percent(item.pct)} of portfolio</span>)}</div></div>}
    </div>
    <details className="mt-auto border-t border-slate-800 px-5 py-3 text-xs leading-relaxed text-slate-400 sm:px-6">
      <summary className="cursor-pointer">Data sources &amp; methodology</summary>
      <div className="mt-3 space-y-3">
        {data && <div className="space-y-3">
          <p>Mapped regions cover {detailPercent(data.mappedPct)} of equity funds. The remaining {detailPercent(data.residualPct)} is detailed here; regional percentages are not increased to total 100%.</p>
          {residualRows.map(group => <div key={group.name}><p className="font-medium text-slate-300">{group.name} · {detailPercent(group.rows.reduce((sum, row) => sum + row.pct, 0))}</p><p>{group.rows.map(row => `${row.ticker} ${detailPercent(row.pct)}`).join(" · ")}</p></div>)}
          {!!data.residuals.unmappedCountries.length && <div><p className="font-medium text-slate-300">Countries awaiting regional mapping</p>{data.residuals.unmappedCountries.map(country => <p key={country.name}>{country.name} · {detailPercent(country.pct)} ({country.contributions.map(row => `${row.ticker} ${detailPercent(row.pct)}`).join(" · ")})</p>)}</div>}
        </div>}
        <p>Region, country and ETF contribution percentages use the combined value of the equity funds as denominator. The subtitle and Outside equities amounts use the entire portfolio. SGOV and IAU are excluded from geographic percentages.</p>
        <p>Countries are aggregated from issuer holdings and assigned to fixed named regions. Country attribution follows the provider’s classification; it does not measure where companies earn revenue. Mexico is in Latin America &amp; Caribbean; Turkey is in Middle East; Russia is in Europe. Countries without a regional mapping are listed here.</p>
        <p>Every refresh uses your current ETF market values. Issuer holdings and the verified fund classification refresh automatically each week with market sync. Failed requests preserve the last valid data and reporting date.</p>
        {!!data?.fundScopeTickers.length && <p>{data.fundScopeTickers.join(", ")}: holding-level countries are absent from the Vanguard feed. This allocation uses Vanguard’s published domestic US equity classification, rechecked from its product page. It is fund market scope, not a measured country for each holding.</p>}
        {!!data?.missingTickers.length && <p>Country information unavailable for {data.missingTickers.join(", ")}; its full weight is included in Missing countries above.</p>}
        <p>Cash &amp; non-equity holdings includes only issuer-reported non-equity weights, capped at the remaining fund balance. Reporting / rounding differences is the remaining unreconciled balance, not verified cash or proven missing countries. Older cached compositions may lack the non-equity breakdown until refresh; their residual stays in Reporting / rounding differences.</p>
        <p>Small residuals stay in this drawer. A visible country-coverage notice appears if an entire fund lacks country data, or missing countries and countries awaiting regional mapping total at least 1% of equity funds. This is a display threshold, not an investment risk rating; cash and reporting differences do not trigger it.</p>
        {data?.sources.map(source => <p key={source.ticker} className={source.stale ? "text-amber-400" : ""}><span className="font-medium text-slate-200">{source.ticker}</span> · {source.source} · {source.basis === "holdings" ? "Holding countries" : source.basis === "fund-scope" ? "Fund market classification" : "Country data unavailable"} · Holdings as of {source.asOf} · Retrieved {source.refreshedAt.slice(0, 10)}{source.stale ? " · Refresh overdue; last valid data" : ""}</p>)}
      </div>
    </details>
  </section>;
}
