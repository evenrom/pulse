import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { refreshSectorAllocationCache, readSectorAllocationCache } from "./sector-allocation-cache";
import { resolveSectorAllocation, SECTOR_REFRESH_INTERVAL_MS } from "./sector-allocation";

function databaseForTest(t: TestContext) {
  const client = createClient({ url: "file::memory:" });
  t.after(() => client.close());
  return drizzle(client);
}

const now = Date.parse("2026-10-11T12:00:00Z");
const weights = { Technology: 0.4, Financials: 0.6 };

test("cache setup is idempotent and a successful refresh survives subsequent reads", async t => {
  const db = databaseForTest(t);
  assert.equal((await readSectorAllocationCache(db)).size, 0);
  const result = await refreshSectorAllocationCache(db, ["VOO", "VOO", "SGOV", "IAU"], async () => weights, now);
  assert.deepEqual(result.updatedTickers, ["VOO"]);
  assert.deepEqual(result.failedTickers, []);
  const cache = await readSectorAllocationCache(db);
  assert.equal(cache.size, 1);
  assert.deepEqual(resolveSectorAllocation("VOO", cache.get("VOO"), now).weights, weights);
});

test("a fresh cache avoids the provider entirely", async t => {
  const db = databaseForTest(t);
  await refreshSectorAllocationCache(db, ["VOO"], async () => weights, now);
  const result = await refreshSectorAllocationCache(db, ["VOO"], async () => { throw new Error("must not fetch"); }, now + 1000);
  assert.deepEqual(result, { updatedTickers: [], failedTickers: [] });
});

test("a failed refresh preserves the last good data and date, then backs off", async t => {
  const db = databaseForTest(t);
  await refreshSectorAllocationCache(db, ["VOO"], async () => weights, now);
  let calls = 0;
  const unavailable = async () => { calls++; throw new Error("Yahoo unavailable"); };
  const later = now + SECTOR_REFRESH_INTERVAL_MS;
  const result = await refreshSectorAllocationCache(db, ["VOO"], unavailable, later);
  assert.deepEqual(result.failedTickers, [{ ticker: "VOO", error: "Yahoo unavailable" }]);
  const cached = (await readSectorAllocationCache(db)).get("VOO")!;
  assert.deepEqual(cached.weights, weights);
  assert.equal(cached.refreshed_at, new Date(now).toISOString());
  assert.equal(cached.last_attempt_at, new Date(later).toISOString());
  assert.equal(resolveSectorAllocation("VOO", cached, later).isStale, true);
  await refreshSectorAllocationCache(db, ["VOO"], unavailable, later + 1000);
  assert.equal(calls, 1);
});

test("one bad ticker does not prevent another ticker's valid refresh", async t => {
  const db = databaseForTest(t);
  const result = await refreshSectorAllocationCache(db, ["VOO", "VEA"], async ticker => {
    if (ticker === "VOO") return { Technology: 0.3 };
    return weights;
  }, now);
  assert.deepEqual(result.updatedTickers, ["VEA"]);
  assert.equal(result.failedTickers[0].ticker, "VOO");
  const cache = await readSectorAllocationCache(db);
  assert.equal(resolveSectorAllocation("VOO", cache.get("VOO"), now).source, "fallback");
  assert.equal(resolveSectorAllocation("VEA", cache.get("VEA"), now).source, "yahoo");
});

test("an initial provider failure can recover on the next day's attempt", async t => {
  const db = databaseForTest(t);
  await refreshSectorAllocationCache(db, ["VOO"], async () => { throw new Error("Unavailable"); }, now);
  const result = await refreshSectorAllocationCache(db, ["VOO"], async () => weights, now + 24 * 60 * 60 * 1000);
  assert.deepEqual(result.updatedTickers, ["VOO"]);
  const cached = (await readSectorAllocationCache(db)).get("VOO");
  assert.equal(resolveSectorAllocation("VOO", cached).source, "yahoo");
});
