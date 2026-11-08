"use client";

import { useState } from "react";
import { hasMaterialCountryGap } from "@/lib/allocation";
import type { RegionalAllocation as RegionalData } from "@/lib/allocation";

function percent(value: number) { return value > 0 && value < 0.05 ? "<0.1%" : `${value.toFixed(1)}%`; }

export function RegionalAllocation({ data, loading, error }: { data: RegionalData | null; loading: boolean; error: string | null }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [showAllCountries, setShowAllCountries] = useState<Set<string>>(new Set());
  const countries = data?.regions.flatMap(region => region.countries) || [];
  const selected = countries.find(country => country.name === selectedCountry);
  const maximum = Math.max(10, Math.ceil(Math.max(0, ...(data?.regions || []).map(region => region.pct)) / 10) * 10);
  const toggle = (name: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(name)) next.delete(name); else next.add(name); return next; });

  return <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
    <div className="px-5 pb-2 pt-5 sm:px-6"><h3 className="text-lg font-semibold text-white">Regional Split</h3><p className="mt-1 text-xs text-slate-400">Equity funds{data ? ` · ${percent(data.equityPortfolioPct)} of portfolio` : " · Country-based allocation"}</p>
      {data && hasMaterialCountryGap(data) && <p role="status" className="mt-2 text-xs text-amber-400">{data.missingTickers.length ? `Country data unavailable for ${data.missingTickers.join(", ")}` : "Country coverage is incomplete"}</p>}
    </div>
    <div className="px-5 py-3 sm:px-6">
      {loading && !data ? <p role="status" className="py-8 text-sm text-slate-400">Loading fund countries…</p> : error || !data ? <p role="status" className="py-8 text-sm text-slate-400">{error || "Regional data are not available yet."}</p> : !data.regions.length ? <p className="py-8 text-sm text-slate-400">{data.equityPortfolioPct > 0 ? "No mapped country allocation available." : "No equity funds in the portfolio."}</p> : <>
        <div className="mb-3 flex items-center justify-between text-[10px] text-slate-500"><span>Share of equity funds</span><span>Scale 0–{maximum}%</span></div>
        <div className="space-y-5">{data.regions.map((region, index) => {
          const open = expanded.has(region.name);
          return <div key={region.name}>
            <button type="button" aria-expanded={open} aria-controls={`region-countries-${index}`} onClick={() => toggle(region.name)} className="block w-full text-left">
              <span className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-100"><span className="mr-1 inline-block w-3 text-slate-500" aria-hidden="true">{open ? "⌄" : "›"}</span>{region.name}</span><span className="font-semibold tabular-nums text-white">{percent(region.pct)}</span></span>
              <span className="block h-4 overflow-hidden rounded bg-slate-950"><span className={`block h-full rounded ${open ? "bg-accent" : "bg-accent/80"}`} style={{ width: `${region.pct / maximum * 100}%` }} /></span>
            </button>
            {open && <div id={`region-countries-${index}`} className="ml-2 mt-3 space-y-3 border-l border-slate-700 pl-3">{region.countries.slice(0, showAllCountries.has(region.name) ? undefined : 5).map(country => <button key={country.name} type="button" onClick={() => setSelectedCountry(country.name)} aria-pressed={selected?.name === country.name} className="block w-full text-left">
              <span className="mb-1 flex items-baseline justify-between gap-3 text-xs"><span className={selected?.name === country.name ? "text-white underline underline-offset-2" : "text-slate-300"}>{country.name}</span><span className="tabular-nums text-slate-300">{percent(country.pct)}</span></span>
              <span className="block h-1.5 rounded bg-slate-950"><span className="block h-full rounded bg-accent-bright" style={{ width: `${country.pct / maximum * 100}%` }} /></span>
            </button>)}{region.countries.length > 5 && <button type="button" className="text-xs text-sky-300 hover:underline" onClick={() => setShowAllCountries(previous => { const next = new Set(previous); if (next.has(region.name)) next.delete(region.name); else next.add(region.name); return next; })}>{showAllCountries.has(region.name) ? "Show top 5 countries" : `Show all ${region.countries.length} countries`}</button>}</div>}
          </div>;
        })}</div>
        {selected && <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/30 px-4 py-3" role="status"><p className="text-sm font-semibold text-slate-100">{selected.name} · {percent(selected.pct)} of equity funds</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">{selected.contributions.map(item => <span key={item.ticker}>{item.ticker} {percent(item.pct)}</span>)}</div></div>}
      </>}
    </div>
  </section>;
}
