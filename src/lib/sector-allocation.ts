import { CUSTOM_SECTOR_BREAKDOWN, SECTOR_BREAKDOWN } from "./config";

export const SECTOR_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SectorAllocation = {
  weights: Record<string, number>;
  source: "yahoo" | "custom" | "fallback" | "unclassified";
  lastRefreshed: string | null;
  isStale: boolean;
};

export type SectorCacheEntry = {
  ticker: string;
  weights: Record<string, number> | null;
  refreshed_at: string | null;
  last_attempt_at: string;
};

const YAHOO_SECTOR_NAMES: Record<string, string> = {
  technology: "Technology",
  financial_services: "Financials",
  healthcare: "Healthcare",
  consumer_cyclical: "Consumer Cyclical",
  communication_services: "Communications",
  industrials: "Industrials",
  consumer_defensive: "Consumer Defensive",
  energy: "Energy",
  realestate: "Real Estate",
  basic_materials: "Basic Materials",
  utilities: "Utilities",
};

export function isValidSectorWeights(weights: unknown): weights is Record<string, number> {
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) return false;
  const entries = Object.entries(weights);
  if (!entries.length || entries.some(([name, value]) =>
    !name || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1,
  )) return false;
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return Math.abs(total - 1) < 0.000001;
}

/** Yahoo may return numeric weights or { raw, fmt } objects. Never cache a partial mix. */
export function parseYahooSectorWeights(value: unknown): Record<string, number> {
  if (!Array.isArray(value) || !value.length) throw new Error("Yahoo returned no sector weights");
  const weights: Record<string, number> = {};
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid Yahoo sector weights");
    for (const [key, rawValue] of Object.entries(row)) {
      const weight = rawValue && typeof rawValue === "object" && "raw" in rawValue ? rawValue.raw : rawValue;
      if (seen.has(key) || typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new Error("Invalid Yahoo sector weight");
      }
      seen.add(key);
      const name = YAHOO_SECTOR_NAMES[key] || "Other";
      weights[name] = (weights[name] || 0) + weight;
    }
  }
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (total < 0.98 || total > 1.02) throw new Error("Yahoo returned incomplete sector weights");
  if (total < 1 - 0.000001) {
    weights.Other = (weights.Other || 0) + (1 - total);
  } else if (total !== 1) {
    // Correct small provider rounding differences, not materially incomplete data.
    for (const name of Object.keys(weights)) weights[name] /= total;
  }
  return weights;
}

export function resolveSectorAllocation(ticker: string, cached?: SectorCacheEntry, now = Date.now()): SectorAllocation {
  const custom = CUSTOM_SECTOR_BREAKDOWN[ticker];
  if (custom) return { weights: custom, source: "custom", lastRefreshed: null, isStale: false };
  const refreshedAt = Date.parse(cached?.refreshed_at || "");
  if (cached && isValidSectorWeights(cached.weights) && Number.isFinite(refreshedAt)) {
    return {
      weights: cached.weights,
      source: "yahoo",
      lastRefreshed: cached.refreshed_at,
      isStale: now - refreshedAt >= SECTOR_REFRESH_INTERVAL_MS,
    };
  }
  const fallback = SECTOR_BREAKDOWN[ticker];
  return {
    weights: fallback || { Other: 1 },
    source: fallback ? "fallback" : "unclassified",
    lastRefreshed: null,
    isStale: false,
  };
}

export function shouldRefreshSectorAllocation(ticker: string, cached?: SectorCacheEntry, now = Date.now()): boolean {
  if (CUSTOM_SECTOR_BREAKDOWN[ticker]) return false;
  const allocation = resolveSectorAllocation(ticker, cached, now);
  if (allocation.source === "yahoo" && !allocation.isStale) return false;
  const lastAttempt = Date.parse(cached?.last_attempt_at || "");
  return !Number.isFinite(lastAttempt) || now - lastAttempt >= RETRY_INTERVAL_MS;
}
