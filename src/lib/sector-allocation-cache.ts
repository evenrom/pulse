import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { sectorAllocations } from "../db/schema";
import { isValidSectorWeights, shouldRefreshSectorAllocation, type SectorCacheEntry } from "./sector-allocation";
import { fetchYahooSectorWeights } from "./yahoo-sectors";

const initializedDatabases = new WeakMap<LibSQLDatabase, Promise<unknown>>();

// Additive, idempotent setup: existing deployments need no destructive schema migration.
async function ensureCacheTable(database: LibSQLDatabase) {
  let initialization = initializedDatabases.get(database);
  if (!initialization) {
    initialization = database.run(sql`CREATE TABLE IF NOT EXISTS sector_allocations (
      ticker TEXT PRIMARY KEY NOT NULL,
      weights TEXT,
      refreshed_at TEXT,
      last_attempt_at TEXT NOT NULL
    )`).catch(error => {
      initializedDatabases.delete(database);
      throw error;
    });
    initializedDatabases.set(database, initialization);
  }
  await initialization;
}

export async function readSectorAllocationCache(database: LibSQLDatabase): Promise<Map<string, SectorCacheEntry>> {
  await ensureCacheTable(database);
  const rows = await database.select().from(sectorAllocations);
  return new Map(rows.map(row => [row.ticker, row]));
}

export async function refreshSectorAllocationCache(
  database: LibSQLDatabase,
  tickers: string[],
  fetchWeights = fetchYahooSectorWeights,
  now = Date.now(),
) {
  const cache = await readSectorAllocationCache(database);
  const dueTickers = Array.from(new Set(tickers)).filter(ticker => shouldRefreshSectorAllocation(ticker, cache.get(ticker), now));
  const attemptedAt = new Date(now).toISOString();
  const results = await Promise.all(dueTickers.map(async ticker => {
    try {
      const weights = await fetchWeights(ticker);
      if (!isValidSectorWeights(weights)) throw new Error("Invalid sector weights; keeping previous allocation");
      await database.insert(sectorAllocations).values({
        ticker, weights, refreshed_at: attemptedAt, last_attempt_at: attemptedAt,
      }).onConflictDoUpdate({
        target: sectorAllocations.ticker,
        set: { weights, refreshed_at: attemptedAt, last_attempt_at: attemptedAt },
      });
      return { ticker, error: null };
    } catch (error) {
      // Record the failed attempt for daily backoff without touching the last good weights/date.
      await database.insert(sectorAllocations).values({ ticker, last_attempt_at: attemptedAt }).onConflictDoUpdate({
        target: sectorAllocations.ticker,
        set: { last_attempt_at: attemptedAt },
      });
      return { ticker, error: error instanceof Error ? error.message : "Sector refresh failed" };
    }
  }));
  return {
    updatedTickers: results.filter(result => result.error === null).map(result => result.ticker),
    failedTickers: results.filter((result): result is { ticker: string; error: string } => result.error !== null),
  };
}
