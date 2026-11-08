"use client";

import { useMemo, useState } from "react";
import { buildSectorAllocation } from "@/lib/allocation";
import type { SectorCompanyExposure } from "@/lib/portfolio-analytics";
import type { SectorAllocation } from "@/lib/sector-allocation";

type Asset = { ticker: string; quantity: number; value_usd: number; sector_allocation: SectorAllocation };
const SOURCE_LABELS = { yahoo: "Yahoo Finance", franklin: "Franklin Templeton", custom: "Custom asset classification", fallback: "Configured fallback", unclassified: "Unclassified" };

export function SectorEngineAllocation({ assets, companies, loading, failedTickers = [] }: {
  assets: Asset[];
  companies?: SectorCompanyExposure;
  loading: boolean;
  failedTickers?: string[];
}) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const active = assets.filter(asset => asset.quantity > 0);
  const engines = useMemo(() => buildSectorAllocation(assets.filter(asset => asset.quantity > 0).map(asset => ({ ticker: asset.ticker, value: asset.value_usd, weights: asset.sector_allocation?.weights || { Other: 1 } }))), [assets]);
  const sectors = engines.flatMap(engine => engine.sectors);
  const selected = sectors.find(sector => sector.name === selectedName);
  const topCompanies = selected ? companies?.sectors[selected.name] ?? [] : [];
  const nonEquity = selected && ["Gold", "T-Bills", "Cash & Equivalents"].includes(selected.name);
  const maximum = Math.max(10, Math.ceil(Math.max(0, ...engines.map(engine => engine.pct)) / 10) * 10);
  const fallback = active.filter(asset => !asset.sector_allocation || ["fallback", "unclassified"].includes(asset.sector_allocation.source));
  const stale = active.filter(asset => asset.sector_allocation?.isStale);

  return <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
    <div className="px-5 pb-2 pt-5 sm:px-6"><h3 className="text-lg font-semibold text-white">Sector &amp; Engine Allocation</h3><p className="mt-1 text-xs text-slate-400">Share of your entire portfolio</p>
      {(fallback.length > 0 || stale.length > 0 || failedTickers.length > 0) && <p className="mt-2 text-xs text-amber-400">{fallback.length > 0 ? `${fallback.length} configured sector ${fallback.length === 1 ? "mix" : "mixes"}` : "Sector refresh overdue"} · Details below</p>}
    </div>
    <div className="px-5 py-3 sm:px-6">
      {!engines.length ? <p className="py-8 text-sm text-slate-400">No active holdings.</p> : <>
        <div className="mb-2 flex justify-between text-[10px] text-slate-500"><span>0%</span><span>{maximum}%</span></div>
        <div className="space-y-5">{engines.map(engine => <div key={engine.name}>
          <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-100">{engine.name}</span><span className="font-semibold tabular-nums text-white">{engine.pct.toFixed(1)}%</span></div>
          <div className="h-5 overflow-hidden rounded bg-slate-950">
            <div className="flex h-full" style={{ width: `${engine.pct / maximum * 100}%` }}>{engine.sectors.map(sector => <button key={sector.name} type="button" aria-pressed={selected?.name === sector.name} aria-label={`${sector.name}: ${sector.pct.toFixed(2)}% of portfolio; show top stocks`} title={`${sector.name} · ${sector.pct.toFixed(2)}% of portfolio`} onClick={() => setSelectedName(sector.name)} className="sector-segment h-full min-w-0 border-y-2 transition-opacity hover:brightness-125 focus-visible:brightness-125" style={{ width: `${sector.pct / engine.pct * 100}%`, backgroundColor: sector.color, opacity: sector.opacity, borderColor: selected?.name === sector.name ? "white" : "transparent" }} />)}</div>
          </div>
        </div>)}</div>
        {selected && <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/30 px-4 py-3" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-white">{selected.name} · {selected.pct.toFixed(1)}% of portfolio</p>
          {topCompanies.length > 0 ? <>
            <div className="mt-2 flex justify-between gap-2 text-[11px] text-slate-400">
              <span>Top stocks</span><span>% of portfolio</span>
            </div>
            <ol className="mt-1 divide-y divide-slate-800 text-xs text-slate-200">
              {topCompanies.map(company => <li key={company.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 break-words">{company.name}</span>
                <span className="shrink-0 tabular-nums">{company.weight < 0.005 ? "<0.01%" : `${company.weight.toFixed(2)}%`}</span>
              </li>)}
            </ol>
          </> : <p className="mt-2 text-xs text-slate-400">{nonEquity
            ? "This allocation contains no stocks."
            : loading ? "Loading stocks…" : "No classified stocks available for this sector."}</p>}
          {!nonEquity && !!companies?.incompleteTickers.length && (
            <p className="mt-2 text-[11px] text-slate-400">Some sector data are missing for {companies.incompleteTickers.join(", ")}.</p>
          )}
        </div>}
      </>}
    </div>
    <details className="mt-auto border-t border-slate-800 px-5 py-3 text-xs leading-relaxed text-slate-400 sm:px-6">
      <summary className="cursor-pointer">Data sources &amp; methodology</summary>
      <div className="mt-3 space-y-3">
        <p>Engine, sector and stock percentages are shares of the entire portfolio, including SGOV and IAU. Select a sector to see up to five companies ranked by combined exposure across your funds.</p>
        <p>Stock weights come from issuer holdings. iShares supplies sector labels in its holdings files. For VOO, sector labels are matched to IVV holdings by ticker. Franklin Templeton supplies FLAX sector totals separately from its holdings. Stock rankings use holdings with a sector label.</p>
        <p>SGOV is shown as T-Bills and IAU as Gold. Other funds’ cash residuals remain Cash &amp; Equivalents under Other; they are not labeled as Treasury bills. These are composition categories, not risk or safety ratings.</p>
        {fallback.length > 0 && <p className="text-amber-400">Configured fallbacks: {fallback.map(asset => asset.ticker).join(", ")}. Live sector weights are unavailable for these funds.</p>}
        {stale.length > 0 && <p className="text-amber-400">Refresh overdue: {stale.map(asset => asset.ticker).join(", ")}. Last valid weights retained.</p>}
        {failedTickers.length > 0 && <p className="text-amber-400">Latest refresh failed: {failedTickers.join(", ")}. Previous data retained.</p>}
        <ul className="space-y-2">{active.map(asset => <li key={asset.ticker}><span className="font-medium text-slate-200">{asset.ticker}</span> · {SOURCE_LABELS[asset.sector_allocation?.source || "unclassified"]}{asset.sector_allocation?.asOf ? ` · As of ${asset.sector_allocation.asOf}` : ""}{asset.sector_allocation?.lastRefreshed ? ` · Retrieved ${asset.sector_allocation.lastRefreshed.slice(0, 10)}` : ""}</li>)}</ul>
        <p>Equity sector weights refresh weekly during market sync. Retrieval dates are not the fund reporting dates. Any unclassified balance remains visible under Other.</p>
      </div>
    </details>
  </section>;
}
