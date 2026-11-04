"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { classifyVolatility, formatVolatility, VOLATILITY_BANDS } from "@/lib/volatility";

export type RiskReturnPoint = {
  id: string;
  name: string;
  profitPct: number;
  volatility: number;
  weight: number;
  isPortfolio: boolean;
};

type PlottedPoint = RiskReturnPoint & { x: number; y: number; radius: number };
type Label = { x: number; y: number; width: number };

function overlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

/** Move labels, never observations. Leader lines retain the exact data positions. */
function placeLabels(points: PlottedPoint[], width: number, bottom: number) {
  const labels = new Map<string, Label>();
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  for (const point of [...points].sort((a, b) => Number(b.isPortfolio) - Number(a.isPortfolio))) {
    const labelWidth = point.name.length * 6.5 + 3;
    const right = point.x + point.radius + 6;
    const left = point.x - point.radius - labelWidth - 6;
    const center = point.x - labelWidth / 2;
    const candidates = [
      [right, point.y - point.radius - 5], [left, point.y - point.radius - 5],
      [right, point.y + point.radius + 15], [left, point.y + point.radius + 15],
      [center, point.y - point.radius - 12], [center, point.y + point.radius + 22],
      [center, point.y - 45], [center, point.y + 45], [center, point.y - 65],
    ].map(([x, y]) => ({ x: Math.max(53, Math.min(width - labelWidth - 8, x)), y: Math.max(18, Math.min(bottom - 5, y)), width: labelWidth }));
    const score = (label: Label) => {
      const box = { ...label, y: label.y - 12, height: 16 };
      const labelOverlap = placed.reduce((sum, existing) => sum + overlap(box, existing), 0);
      const pointOverlap = points.reduce((sum, other) => sum + overlap(box, { x: other.x - other.radius - 3, y: other.y - other.radius - 3, width: other.radius * 2 + 6, height: other.radius * 2 + 6 }), 0);
      return labelOverlap * 10 + pointOverlap * 5 + Math.hypot(label.x + label.width / 2 - point.x, label.y - point.y) * 0.05;
    };
    const label = candidates.reduce((best, candidate) => score(candidate) < score(best) ? candidate : best);
    labels.set(point.id, label);
    placed.push({ ...label, y: label.y - 12, height: 16 });
  }
  return labels;
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function RiskReturnScatter({ points }: { points: RiskReturnPoint[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [selectedId, setSelectedId] = useState("total-portfolio");
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, Math.round(entries[0].contentRect.width))));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const plot = useMemo(() => {
    const valid = points.filter(point => Number.isFinite(point.volatility) && point.volatility >= 0 && Number.isFinite(point.profitPct));
    const maxX = Math.max(20, Math.ceil(Math.max(0, ...valid.map(point => point.volatility)) * 1.15 / 5) * 5);
    const values = valid.map(point => point.profitPct);
    const span = Math.max(10, Math.max(0, ...values) - Math.min(0, ...values));
    const minY = Math.floor(Math.min(-2, ...values.map(value => value - span * 0.15)) / 5) * 5;
    const maxY = Math.ceil(Math.max(2, ...values.map(value => value + span * 0.15)) / 5) * 5;
    const left = 50, right = width - 22, top = 22, bottom = 258;
    const x = (value: number) => left + value / maxX * (right - left);
    const y = (value: number) => bottom - (value - minY) / (maxY - minY) * (bottom - top);
    const largestWeight = Math.max(1, ...valid.filter(point => !point.isPortfolio).map(point => point.weight));
    const plotted = valid.map(point => ({ ...point, x: x(point.volatility), y: y(point.profitPct), radius: point.isPortfolio ? 8 : Math.max(4, 12 * Math.sqrt(Math.max(0, point.weight) / largestWeight)) }));
    return { points: plotted, labels: placeLabels(plotted, width, bottom), maxX, minY, maxY, left, right, top, bottom, x, y };
  }, [points, width]);
  const selected = plot.points.find(point => point.id === selectedId) || plot.points.find(point => point.isPortfolio) || plot.points[0];
  const selectedBand = classifyVolatility(selected?.volatility);

  return <div ref={container} className="min-w-0 px-4 pb-3 pt-4 sm:px-5">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-medium text-slate-200">Volatility vs. your cumulative profit</h4>
      <span className="text-[10px] text-slate-500">● Fund · ◆ Total Portfolio</span>
    </div>
    {!plot.points.length ? <p className="py-12 text-sm text-slate-400">No comparable profit and volatility observations yet.</p> : <>
      <svg viewBox={`0 0 ${width} 300`} className="block w-full" aria-label="Annualized volatility on the horizontal axis and your cumulative profit on the vertical axis. Select a fund or the portfolio for details.">
        {VOLATILITY_BANDS.map(band => {
          const end = Math.min(plot.maxX, band.max);
          return end > band.min ? <rect key={band.key} x={plot.x(band.min)} y={plot.top} width={plot.x(end) - plot.x(band.min)} height={plot.bottom - plot.top} fill={band.color} opacity={0.055} /> : null;
        })}
        {[0, 1, 2, 3, 4].map(index => {
          const xValue = plot.maxX * index / 4;
          const yValue = plot.minY + (plot.maxY - plot.minY) * index / 4;
          return <g key={index} aria-hidden="true">
            <line x1={plot.x(xValue)} x2={plot.x(xValue)} y1={plot.top} y2={plot.bottom} stroke="#334155" strokeDasharray="3 4" />
            <line x1={plot.left} x2={plot.right} y1={plot.y(yValue)} y2={plot.y(yValue)} stroke="#334155" strokeDasharray="3 4" />
            <text x={plot.x(xValue)} y={plot.bottom + 18} textAnchor="middle" fill="#94a3b8" fontSize={10}>{Number(xValue.toFixed(1))}%</text>
            <text x={plot.left - 7} y={plot.y(yValue) + 3} textAnchor="end" fill="#94a3b8" fontSize={10}>{Number(yValue.toFixed(1))}%</text>
          </g>;
        })}
        <line x1={plot.left} x2={plot.right} y1={plot.y(0)} y2={plot.y(0)} stroke="#cbd5e1" strokeWidth={1.2} />
        <text x={plot.right - 3} y={plot.y(0) - 5} textAnchor="end" fill="#cbd5e1" fontSize={10}>0% profit</text>
        <text x={plot.left} y={12} fill="#94a3b8" fontSize={10}>Cumulative profit (%)</text>
        <text x={(plot.left + plot.right) / 2} y={296} textAnchor="middle" fill="#94a3b8" fontSize={11}>Annualized volatility (%)</text>
        {plot.points.map(point => {
          const band = classifyVolatility(point.volatility)!;
          const label = plot.labels.get(point.id)!;
          const active = point.id === selected?.id;
          const description = `${point.name}: cumulative profit ${signed(point.profitPct)}, annualized volatility ${formatVolatility(point.volatility)}, ${band.label}${point.isPortfolio ? "" : `, portfolio weight ${point.weight.toFixed(1)}%`}`;
          return <g key={point.id} role="button" tabIndex={0} aria-label={description} aria-pressed={active} className="cursor-pointer" onMouseEnter={() => setSelectedId(point.id)} onFocus={() => setSelectedId(point.id)} onClick={() => setSelectedId(point.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(point.id); } }}>
            <title>{description}</title>
            <line x1={point.x} y1={point.y} x2={Math.max(label.x, Math.min(label.x + label.width, point.x))} y2={label.y - 5} stroke="#64748b" opacity={0.65} pointerEvents="none" />
            {point.isPortfolio ? <path d={`M ${point.x} ${point.y - 8} l 8 8 l -8 8 l -8 -8 Z`} fill={band.color} stroke="white" strokeWidth={2} /> : <circle cx={point.x} cy={point.y} r={point.radius} fill={band.color} fillOpacity={active ? 1 : 0.8} stroke={active ? "white" : "#0f172a"} strokeWidth={1.5} />}
            <text x={label.x} y={label.y} fill={point.isPortfolio ? "#ffffff" : "#cbd5e1"} fontSize={12} fontWeight={point.isPortfolio ? 600 : 400}>{point.name}</text>
          </g>;
        })}
        {/* A visual-only overlay keeps the active marker visible without changing keyboard tab order. */}
        {selected && <g pointerEvents="none" aria-hidden="true">
          <circle cx={selected.x} cy={selected.y} r={selected.radius + 5} fill="none" stroke="#e2e8f0" strokeDasharray="2 3" />
          {selected.isPortfolio ? <path d={`M ${selected.x} ${selected.y - 8} l 8 8 l -8 8 l -8 -8 Z`} fill={selectedBand?.color} stroke="white" strokeWidth={2} /> : <circle cx={selected.x} cy={selected.y} r={selected.radius} fill={selectedBand?.color} stroke="white" strokeWidth={1.5} />}
        </g>}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">{VOLATILITY_BANDS.map(band => <span key={band.key} className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: band.color }} />{band.label} {band.range}</span>)}</div>
      {selected && <div className="mt-3 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-950/40 px-3 py-2 text-xs" role="status" aria-live="polite">
        <strong className="text-slate-100">{selected.name}</strong><span className={selected.profitPct > 0 ? "text-emerald-400" : selected.profitPct < 0 ? "text-red-400" : "text-slate-300"}>{signed(selected.profitPct)} profit</span><span className={selectedBand?.textClass}>{formatVolatility(selected.volatility)} · {selectedBand?.label} volatility</span>{!selected.isPortfolio && <span className="text-slate-400">{selected.weight.toFixed(1)}% of portfolio</span>}
      </div>}
    </>}
    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">Profit: since your first investment in each holding. Volatility: the shared trailing-year sample. Different periods; no efficiency score or investment ranking. Circle area approximates fund weight; small circles have a minimum size.</p>
  </div>;
}
