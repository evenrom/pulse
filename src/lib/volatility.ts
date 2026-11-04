/** Pulse display bands, grouped around historical CESR/10-673 boundaries.
 * Not an SRRI/PRIIPs rating: Pulse uses one year of daily USD returns, not five years of weekly returns.
 * Colors deliberately differ from profit/loss green/red.
 */
export const VOLATILITY_SOURCE = "https://www.esma.europa.eu/sites/default/files/library/2015/11/10_673.pdf";
export const VOLATILITY_BANDS = [
  { key: "low", label: "Low", min: 0, max: 5, color: "#38bdf8", textClass: "text-sky-300", barClass: "bg-sky-400", range: "<5%" },
  { key: "medium", label: "Medium", min: 5, max: 15, color: "#fbbf24", textClass: "text-amber-300", barClass: "bg-amber-400", range: "5–<15%" },
  { key: "high", label: "High", min: 15, max: Infinity, color: "#c084fc", textClass: "text-purple-300", barClass: "bg-purple-400", range: "≥15%" },
] as const;

export function classifyVolatility(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return VOLATILITY_BANDS.find(band => value >= band.min && value < band.max) || null;
}

export function formatVolatility(value: number) {
  const rounded = value.toFixed(1);
  // Avoid displaying “15.0% Medium” for an unrounded value just below the boundary.
  const boundary = [5, 15].find(limit => value < limit && Number(rounded) >= limit);
  return `${boundary ? `<${boundary.toFixed(1)}` : rounded}%`;
}
