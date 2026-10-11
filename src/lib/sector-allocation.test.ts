import assert from "node:assert/strict";
import test from "node:test";
import { parseYahooSectorWeights, resolveSectorAllocation, shouldRefreshSectorAllocation, SECTOR_REFRESH_INTERVAL_MS, type SectorCacheEntry } from "./sector-allocation";

const now = Date.parse("2026-10-11T12:00:00Z");
const cached: SectorCacheEntry = {
  ticker: "VOO",
  weights: { Technology: 0.4, Financials: 0.6 },
  refreshed_at: new Date(now).toISOString(),
  last_attempt_at: new Date(now).toISOString(),
};

test("Yahoo numeric and raw-object weights map to the existing engines' sector names", () => {
  assert.deepEqual(parseYahooSectorWeights([
    { technology: { raw: 0.4, fmt: "40%" } },
    { financial_services: 0.3 },
    { communication_services: 0.1 },
    { realestate: 0.2 },
  ]), { Technology: 0.4, Financials: 0.3, Communications: 0.1, "Real Estate": 0.2 });
});

test("unknown sectors and missing small residuals remain visible rather than being discarded", () => {
  const weights = parseYahooSectorWeights([{ technology: 0.8 }, { new_sector: 0.19 }]);
  assert.equal(weights.Technology, 0.8);
  assert.ok(Math.abs(weights.Other - 0.2) < 0.000001);
});

test("minor provider rounding is reconciled to 100%", () => {
  const weights = parseYahooSectorWeights([{ technology: 0.5001 }, { financial_services: 0.5 }]);
  assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 0.000001);
  const rounded = parseYahooSectorWeights([{ technology: 0.4 }, { financial_services: 0.59999999 }]);
  assert.deepEqual(Object.keys(rounded), ["Technology", "Financials"]);
  assert.ok(Math.abs(rounded.Technology - 0.4) < 0.000001);
  assert.ok(Math.abs(rounded.Technology + rounded.Financials - 1) < 0.000001);
});

test("empty, partial, duplicate, malformed and out-of-range responses are rejected", () => {
  for (const value of [
    undefined, [], [{}], [{ technology: 0.4 }], [{ technology: -0.1 }],
    [{ technology: 1.5 }], [{ technology: "1" }], [{ technology: NaN }],
    [{ technology: 0.5 }, { technology: 0.5 }], [{ technology: { fmt: "100%" } }],
  ]) assert.throws(() => parseYahooSectorWeights(value));
});

test("a stale Yahoo allocation is kept with its original successful refresh date", () => {
  const allocation = resolveSectorAllocation("VOO", cached, now + SECTOR_REFRESH_INTERVAL_MS);
  assert.equal(allocation.source, "yahoo");
  assert.equal(allocation.isStale, true);
  assert.equal(allocation.lastRefreshed, cached.refreshed_at);
  assert.deepEqual(allocation.weights, cached.weights);
});

test("SGOV and IAU always keep their custom classifications", () => {
  assert.equal(resolveSectorAllocation("SGOV", cached).source, "custom");
  assert.deepEqual(resolveSectorAllocation("SGOV", cached).weights, { "Cash & Equivalents": 1 });
  assert.deepEqual(resolveSectorAllocation("IAU", cached).weights, { Commodities: 1 });
  assert.equal(shouldRefreshSectorAllocation("IAU"), false);
  assert.equal(shouldRefreshSectorAllocation("SGOV"), false);
});

test("initial fallback and unknown funds are explicitly identified", () => {
  assert.equal(resolveSectorAllocation("VOO").source, "fallback");
  assert.equal(resolveSectorAllocation("VOO").lastRefreshed, null);
  assert.equal(resolveSectorAllocation("NEWETF").source, "unclassified");
  assert.deepEqual(resolveSectorAllocation("NEWETF").weights, { Other: 1 });
  assert.equal(resolveSectorAllocation("VOO", { ...cached, weights: { Technology: 0.5 } }).source, "fallback");
});

test("refresh is weekly, with daily backoff after a failed attempt", () => {
  assert.equal(shouldRefreshSectorAllocation("VOO", undefined, now), true);
  assert.equal(shouldRefreshSectorAllocation("VOO", cached, now + SECTOR_REFRESH_INTERVAL_MS - 1), false);
  assert.equal(shouldRefreshSectorAllocation("VOO", cached, now + SECTOR_REFRESH_INTERVAL_MS), true);
  const failed = { ...cached, last_attempt_at: new Date(now + SECTOR_REFRESH_INTERVAL_MS).toISOString() };
  assert.equal(shouldRefreshSectorAllocation("VOO", failed, now + SECTOR_REFRESH_INTERVAL_MS + 1000), false);
  assert.equal(shouldRefreshSectorAllocation("VOO", failed, now + SECTOR_REFRESH_INTERVAL_MS + 24 * 60 * 60 * 1000), true);
});
