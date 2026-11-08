import { ENGINE_MAP, SECTOR_TO_ENGINE } from "./config";
import type { FundComposition } from "./portfolio-analytics";

export const ENGINE_COLORS: Record<string, string> = {
  Innovation: "#60a5fa", "Human Life": "#a78bfa", Capital: "#2dd4bf", Production: "#fb923c", Energy: "#4ade80", "Gold & T-Bills": "#fbbf24", Other: "#94a3b8",
};
export type AllocationContribution = { ticker: string; pct: number };
export type SectorSlice = { name: string; pct: number; color: string; opacity: number; contributions: AllocationContribution[] };
export type EngineAllocation = { name: string; pct: number; color: string; sectors: SectorSlice[] };
export type CountryAllocation = { name: string; pct: number; contributions: AllocationContribution[] };
export type RegionalAllocation = {
  equityPortfolioPct: number;
  mappedPct: number;
  residualPct: number;
  regions: { name: string; pct: number; countries: CountryAllocation[] }[];
  residuals: { nonEquity: AllocationContribution[]; reportingGap: AllocationContribution[]; missingCountries: AllocationContribution[]; unmappedCountries: CountryAllocation[] };
  outsideEquities: AllocationContribution[];
  missingTickers: string[];
  fundScopeTickers: string[];
  sources: { ticker: string; source: string; asOf: string; refreshedAt: string; stale: boolean; basis: string }[];
};

export function buildSectorAllocation(assets: { ticker: string; value: number; weights: Record<string, number> }[]): EngineAllocation[] {
  const active = assets.filter(asset => Number.isFinite(asset.value) && asset.value > 0);
  const total = active.reduce((sum, asset) => sum + asset.value, 0);
  const sectors = new Map<string, Map<string, number>>();
  for (const asset of active) {
    const weights = asset.ticker === "SGOV" ? { "T-Bills": 1 } : asset.ticker === "IAU" ? { Gold: 1 } : asset.weights;
    let mapped = 0;
    for (const [name, weight] of Object.entries(weights)) {
      if (!Number.isFinite(weight) || weight <= 0 || weight > 1) continue;
      const pct = asset.value / total * weight * 100;
      if (!sectors.has(name)) sectors.set(name, new Map());
      const funds = sectors.get(name)!;
      funds.set(asset.ticker, (funds.get(asset.ticker) || 0) + pct);
      mapped += weight;
    }
    if (mapped < 1 - 1e-8) {
      if (!sectors.has("Other")) sectors.set("Other", new Map());
      sectors.get("Other")!.set(asset.ticker, (sectors.get("Other")!.get(asset.ticker) || 0) + asset.value / total * (1 - mapped) * 100);
    }
  }
  const engines = new Map<string, EngineAllocation>();
  for (const [name, funds] of Array.from(sectors)) {
    const engineName = SECTOR_TO_ENGINE[name] || "Other";
    const engine = engines.get(engineName) || { name: engineName, pct: 0, color: ENGINE_COLORS[engineName] || ENGINE_COLORS.Other, sectors: [] };
    const contributions = Array.from(funds, ([ticker, pct]) => ({ ticker, pct })).sort((a, b) => b.pct - a.pct);
    const pct = contributions.reduce((sum, contribution) => sum + contribution.pct, 0);
    // A stable sector-name hash, rather than changing rank, sets the tint.
    const hash = Array.from(name).reduce((value, char) => value + char.charCodeAt(0), 0);
    const position = ENGINE_MAP[engineName]?.indexOf(name) ?? -1;
    engine.sectors.push({ name, pct, color: name === "T-Bills" ? "#94a3b8" : engine.color, opacity: name === "Gold" || name === "T-Bills" ? 1 : position >= 0 ? Math.max(0.55, 1 - position * 0.2) : 0.55 + hash % 4 * 0.15, contributions });
    engine.pct += pct;
    engines.set(engineName, engine);
  }
  return Array.from(engines.values()).map(engine => ({ ...engine, sectors: engine.sectors.sort((a, b) => b.pct - a.pct) })).sort((a, b) => b.pct - a.pct);
}

const COUNTRY_GROUPS: Record<string, string[]> = {
  "North America": ["United States", "Canada", "Bermuda"],
  Europe: ["United Kingdom", "France", "Germany", "Switzerland", "Netherlands", "Spain", "Italy", "Sweden", "Denmark", "Finland", "Norway", "Belgium", "Austria", "Ireland", "Portugal", "Greece", "Poland", "Czech Republic", "Hungary", "Luxembourg", "Iceland", "Estonia", "Latvia", "Lithuania", "Slovenia", "Slovakia", "Croatia", "Romania", "Bulgaria", "Cyprus", "Malta", "Russia", "Ukraine", "Liechtenstein", "Jersey", "Guernsey", "Isle of Man"],
  "Asia & Pacific": ["Japan", "Australia", "New Zealand", "Singapore", "Hong Kong", "China", "Taiwan", "South Korea", "India", "Indonesia", "Malaysia", "Thailand", "Philippines", "Vietnam", "Pakistan", "Bangladesh", "Sri Lanka", "Mongolia", "Kazakhstan", "Cambodia", "Macau"],
  "Middle East": ["Israel", "Turkey", "Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait", "Bahrain", "Oman", "Jordan", "Lebanon"],
  "Latin America & Caribbean": ["Mexico", "Brazil", "Argentina", "Chile", "Peru", "Colombia", "Uruguay", "Panama", "Costa Rica", "Cayman Islands", "Bahamas", "British Virgin Islands", "Puerto Rico"],
  Africa: ["South Africa", "Egypt", "Morocco", "Kenya", "Nigeria", "Ghana", "Tunisia", "Mauritius"],
};
const COUNTRY_TO_REGION = new Map(Object.entries(COUNTRY_GROUPS).flatMap(([region, countries]) => countries.map(country => [country, region] as const)));
const COUNTRY_ALIASES: Record<string, string> = { US: "United States", USA: "United States", "United States of America": "United States", UK: "United Kingdom", "Great Britain": "United Kingdom", "Korea (South)": "South Korea", "Korea, Republic of": "South Korea", "Republic of Korea": "South Korea", "Czechia": "Czech Republic", "Russian Federation": "Russia", "Hong Kong SAR": "Hong Kong" };
export function normalizeCountry(value: string) { const name = value.trim(); return name === "Macao" ? "Macau" : COUNTRY_ALIASES[name] || name; }

/** A whole missing fund or at least 1% missing/unmapped equity-fund value merits a visible notice. */
export function hasMaterialCountryGap(data: RegionalAllocation) {
  return data.missingTickers.length > 0 || data.residuals.missingCountries.reduce((sum, row) => sum + row.pct, 0) + data.residuals.unmappedCountries.reduce((sum, row) => sum + row.pct, 0) >= 1;
}

/** All country/region percentages share the complete equity-fund denominator, including unknowns. */
export function aggregateRegionalAllocation(assets: { ticker: string; value: number }[], compositions: Map<string, FundComposition>): RegionalAllocation {
  const active = assets.filter(asset => Number.isFinite(asset.value) && asset.value > 0);
  const total = active.reduce((sum, asset) => sum + asset.value, 0);
  const equities = active.filter(asset => !["SGOV", "IAU"].includes(asset.ticker));
  const equityTotal = equities.reduce((sum, asset) => sum + asset.value, 0);
  const result: RegionalAllocation = { equityPortfolioPct: total > 0 ? equityTotal / total * 100 : 0, mappedPct: 0, residualPct: 0, regions: [], residuals: { nonEquity: [], reportingGap: [], missingCountries: [], unmappedCountries: [] }, outsideEquities: active.filter(asset => ["SGOV", "IAU"].includes(asset.ticker)).map(asset => ({ ticker: asset.ticker, pct: asset.value / total * 100 })), missingTickers: [], fundScopeTickers: [], sources: [] };
  const regions = new Map<string, Map<string, Map<string, number>>>();
  const unmapped = new Map<string, Map<string, number>>();
  function remainder(kind: "nonEquity" | "reportingGap" | "missingCountries", pct: number, ticker: string) {
    if (!(pct > 1e-9)) return;
    const previous = result.residuals[kind].find(row => row.ticker === ticker);
    if (previous) previous.pct += pct;
    else result.residuals[kind].push({ ticker, pct });
    result.residualPct += pct;
  }
  function add(country: string, pct: number, ticker: string) {
    if (!(pct > 1e-9)) return;
    const knownName = normalizeCountry(country);
    if (!knownName || knownName === "-") { remainder("missingCountries", pct, ticker); return; }
    const region = COUNTRY_TO_REGION.get(knownName);
    if (!region) {
      if (!unmapped.has(knownName)) unmapped.set(knownName, new Map());
      const funds = unmapped.get(knownName)!;
      funds.set(ticker, (funds.get(ticker) || 0) + pct);
      result.residualPct += pct;
      return;
    }
    if (!regions.has(region)) regions.set(region, new Map());
    const countries = regions.get(region)!;
    if (!countries.has(knownName)) countries.set(knownName, new Map());
    countries.get(knownName)!.set(ticker, (countries.get(knownName)!.get(ticker) || 0) + pct);
    result.mappedPct += pct;
  }
  for (const asset of equities) {
    const composition = compositions.get(asset.ticker);
    const fundPct = asset.value / equityTotal * 100;
    // Legacy iShares payloads already contain real Location fields. Legacy Vanguard US defaults do not.
    const basis = composition?.geography?.basis || (composition?.source === "iShares" ? "holdings" : "unavailable");
    let allocated = 0;
    if (composition && basis === "holdings") {
      for (const holding of composition.holdings) {
        if (!Number.isFinite(holding.weight) || holding.weight < 0) continue;
        const weight = Math.min(holding.weight, Math.max(0, 1 - allocated));
        add(holding.country, fundPct * weight, asset.ticker);
        allocated += weight;
      }
    } else if (composition?.geography?.basis === "issuer-allocation") {
      for (const { country, weight } of composition.geography.countries) {
        const cappedWeight = Math.min(weight, Math.max(0, 1 - allocated));
        add(country, fundPct * cappedWeight, asset.ticker);
        allocated += cappedWeight;
      }
    } else if (composition?.geography?.basis === "fund-scope" && composition.geography.country) {
      allocated = Math.max(0, Math.min(1, composition.equityWeight));
      add(composition.geography.country, fundPct * allocated, asset.ticker);
      result.fundScopeTickers.push(asset.ticker);
    } else {
      result.missingTickers.push(asset.ticker);
      remainder("missingCountries", fundPct, asset.ticker);
      continue;
    }
    const residual = Math.max(0, 1 - allocated);
    const reportedNonEquity = composition?.geography?.basis === "issuer-allocation"
      ? composition.geography.cashWeight
      : composition?.nonEquityWeight;
    const nonEquity = typeof reportedNonEquity === "number" && Number.isFinite(reportedNonEquity) ? Math.min(residual, Math.max(0, reportedNonEquity)) : 0;
    remainder("nonEquity", fundPct * nonEquity, asset.ticker);
    remainder("reportingGap", fundPct * Math.max(0, residual - nonEquity), asset.ticker);
  }
  result.regions = Array.from(regions, ([name, countries]) => {
    const rows = Array.from(countries, ([country, funds]) => {
      const contributions = Array.from(funds, ([ticker, pct]) => ({ ticker, pct })).sort((a, b) => b.pct - a.pct);
      return { name: country, pct: contributions.reduce((sum, item) => sum + item.pct, 0), contributions };
    }).sort((a, b) => b.pct - a.pct);
    return { name, pct: rows.reduce((sum, country) => sum + country.pct, 0), countries: rows };
  }).sort((a, b) => b.pct - a.pct);
  result.residuals.unmappedCountries = Array.from(unmapped, ([name, funds]) => {
    const contributions = Array.from(funds, ([ticker, pct]) => ({ ticker, pct })).sort((a, b) => b.pct - a.pct);
    return { name, pct: contributions.reduce((sum, row) => sum + row.pct, 0), contributions };
  }).sort((a, b) => b.pct - a.pct);
  return result;
}
