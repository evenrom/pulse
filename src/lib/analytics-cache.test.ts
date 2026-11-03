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
  const holdings: FundComposition = { holdings: [], asOf: "2026-11-02", source: "test", equityWeight: 1 };
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
