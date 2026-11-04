import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { analyticsStartDate, readAnalyticsCache, refreshAnalyticsCache, HOLDINGS_REFRESH_MS } from "./analytics-cache";
import type { FundComposition, PriceHistory } from "./portfolio-analytics";

test("analytics cache refreshes independently, preserves last good data on failure, and backs off", async t => {
  const client = createClient({ url: "file::memory:" }); t.after(() => client.close());
  const db = drizzle(client);
  const now = Date.parse("2026-11-03T12:00:00Z");
  const prices: PriceHistory = { prices: [{ date: "2026-11-02", close: 100, adjustedClose: 100 }], requestedFrom: "2025-01-01", splitDates: [] };
  const holdings: FundComposition = { holdings: [], asOf: "2026-11-02", source: "test", equityWeight: 1, geography: { basis: "holdings" } };
  let count = 0;
  const providers = { prices: async () => { count++; return prices; }, holdings: async () => holdings };
  await refreshAnalyticsCache(db, ["VOO", "VOO", "SGOV", "IAU"], "2025-01-01", providers, now);
  assert.equal(count, 3);
  assert.equal((await readAnalyticsCache(db)).size, 4);
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", providers, now + 1000);
  assert.equal(count, 3);
  const fail = { prices: async () => { count++; throw new Error("offline"); }, holdings: async () => { throw new Error("offline"); } };
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", fail, now + HOLDINGS_REFRESH_MS);
  const entry = (await readAnalyticsCache(db)).get("prices:v1:VOO")!;
  assert.deepEqual(entry.payload, prices);
  assert.equal(entry.refreshed_at, new Date(now).toISOString());
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", fail, now + HOLDINGS_REFRESH_MS + 1000);
  assert.equal(count, 4);
});

test("history start includes sold positions and at least one year for risk estimation", () => {
  assert.equal(analyticsStartDate([null, "bad", "2020-01-01T00:00:00Z"], Date.parse("2026-11-03")), "2020-01-01");
  assert.equal(analyticsStartDate(["2026-10-01"], Date.parse("2026-11-03")), "2025-10-24");
});

test("fresh legacy holdings upgrade immediately once, preserving payload and backing off if upgrade fails", async t => {
  const client = createClient({ url: "file::memory:" }); t.after(() => client.close());
  const db = drizzle(client);
  const now = Date.parse("2026-11-03T12:00:00Z");
  const prices: PriceHistory = { prices: [], requestedFrom: "2025-01-01", splitDates: [] };
  const legacy: FundComposition = { holdings: [], asOf: "2026-10-31", source: "Vanguard", equityWeight: 1 };
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", { prices: async () => prices, holdings: async () => legacy }, now);
  let attempts = 0;
  const offline = { prices: async () => prices, holdings: async () => { attempts++; throw new Error("offline"); } };
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", offline, now + 1000);
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", offline, now + 2000);
  assert.equal(attempts, 1);
  assert.deepEqual((await readAnalyticsCache(db)).get("holdings:v1:VOO")!.payload, legacy);
  const upgraded = { ...legacy, geography: { basis: "fund-scope" as const, country: "United States" } };
  const providers = { prices: async () => prices, holdings: async () => { attempts++; return upgraded; } };
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", providers, now + 3601001);
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", providers, now + 3601002);
  assert.equal(attempts, 2);
  assert.deepEqual((await readAnalyticsCache(db)).get("holdings:v1:VOO")!.payload, upgraded);
});

test("failed geography cannot replace valid country data or its retrieval date", async t => {
  const client = createClient({ url: "file::memory:" }); t.after(() => client.close());
  const db = drizzle(client);
  const now = Date.parse("2026-11-03T12:00:00Z");
  const prices: PriceHistory = { prices: [], requestedFrom: "2025-01-01", splitDates: [] };
  const valid: FundComposition = { holdings: [], asOf: "2026-10-31", source: "Vanguard", equityWeight: 1, geography: { basis: "fund-scope", country: "United States" } };
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", { prices: async () => prices, holdings: async () => valid }, now);
  let attempts = 0;
  const providers = { prices: async () => prices, holdings: async () => { attempts++; return { ...valid, geography: { basis: "unavailable" as const } }; } };
  const results = await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", providers, now + HOLDINGS_REFRESH_MS);
  assert.match(results.find(row => row.key === "holdings:v1:VOO")!.error!, /keeping the last valid/);
  const saved = (await readAnalyticsCache(db)).get("holdings:v1:VOO")!;
  assert.deepEqual(saved.payload, valid);
  assert.equal(saved.refreshed_at, new Date(now).toISOString());
  await refreshAnalyticsCache(db, ["VOO"], "2025-01-01", providers, now + HOLDINGS_REFRESH_MS + 1000);
  assert.equal(attempts, 1);
});

test("fresh iShares caches upgrade once to include non-equity weights, with failure backoff", async t => {
  const client = createClient({ url: "file::memory:" }); t.after(() => client.close());
  const db = drizzle(client);
  const now = Date.parse("2026-11-03T12:00:00Z");
  const prices: PriceHistory = { prices: [], requestedFrom: "2025-01-01", splitDates: [] };
  const legacy: FundComposition = { holdings: [], source: "iShares", asOf: "2026-11-02", equityWeight: 0.9865, geography: { basis: "holdings" } };
  await refreshAnalyticsCache(db, ["IDEV"], "2025-01-01", { prices: async () => prices, holdings: async () => legacy }, now);
  let attempts = 0;
  const fail = { prices: async () => prices, holdings: async () => { attempts++; throw Error("offline"); } };
  await refreshAnalyticsCache(db, ["IDEV"], "2025-01-01", fail, now + 1000);
  await refreshAnalyticsCache(db, ["IDEV"], "2025-01-01", fail, now + 2000);
  assert.equal(attempts, 1);
  assert.deepEqual((await readAnalyticsCache(db)).get("holdings:v1:IDEV")!.payload, legacy);
  const upgraded = { ...legacy, nonEquityWeight: 0.0061 };
  const success = { prices: async () => prices, holdings: async () => { attempts++; return upgraded; } };
  await refreshAnalyticsCache(db, ["IDEV"], "2025-01-01", success, now + 3601001);
  await refreshAnalyticsCache(db, ["IDEV"], "2025-01-01", success, now + 3601002);
  assert.equal(attempts, 2);
  assert.deepEqual((await readAnalyticsCache(db)).get("holdings:v1:IDEV")!.payload, upgraded);
});
