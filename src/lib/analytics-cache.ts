import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { analyticsCache } from "../db/schema";
import { fetchFundComposition, fetchPriceHistory } from "./analytics-providers";
import type { FundComposition, PriceHistory } from "./portfolio-analytics";

export const PRICE_REFRESH_MS = 6 * 60 * 60 * 1000;
export const HOLDINGS_REFRESH_MS = 7 * 86400000;
const RETRY_MS = 60 * 60 * 1000;
export type AnalyticsCacheEntry = { key: string; payload: unknown; refreshed_at: string | null; last_attempt_at: string };
const initialized = new WeakMap<LibSQLDatabase, Promise<unknown>>();

async function ensureTable(database: LibSQLDatabase) {
  let pending = initialized.get(database);
  if (!pending) {
    pending = database.run(sql`CREATE TABLE IF NOT EXISTS analytics_cache (
      key TEXT PRIMARY KEY NOT NULL, payload TEXT, refreshed_at TEXT, last_attempt_at TEXT NOT NULL
    )`).catch(error => { initialized.delete(database); throw error; });
    initialized.set(database, pending);
  }
  await pending;
}

export async function readAnalyticsCache(database: LibSQLDatabase): Promise<Map<string, AnalyticsCacheEntry>> {
  await ensureTable(database);
  return new Map((await database.select().from(analyticsCache)).map(row => [row.key, row]));
}

export async function refreshAnalyticsCache(
  database: LibSQLDatabase,
  tickers: string[],
  from: string,
  providers = { prices: fetchPriceHistory, holdings: fetchFundComposition },
  now = Date.now(),
) {
  const cache = await readAnalyticsCache(database);
  const jobs = Array.from(new Set(tickers)).flatMap(ticker => ["prices", "holdings"].filter(kind => kind !== "holdings" || !["SGOV", "IAU"].includes(ticker)).map(kind => ({ ticker, kind, key: `${kind}:v1:${ticker}` })));
  const attemptedAt = new Date(now).toISOString();
  return Promise.all(jobs.map(async job => {
    const entry = cache.get(job.key);
    const interval = job.kind === "prices" ? PRICE_REFRESH_MS : HOLDINGS_REFRESH_MS;
    const needsEarlierHistory = job.kind === "prices" && (entry?.payload as PriceHistory | null)?.requestedFrom && (entry!.payload as PriceHistory).requestedFrom > from;
    const oldComposition = job.kind === "holdings" ? entry?.payload as FundComposition | undefined : undefined;
    const oldGeography = oldComposition?.geography;
    const missingCountryMetadata = Boolean(oldComposition) && (!oldGeography || (oldComposition?.source === "iShares" && oldComposition.nonEquityWeight === undefined));
    const needsCountryMetadata = missingCountryMetadata || oldGeography?.basis === "unavailable";
    if (!needsEarlierHistory && !needsCountryMetadata && entry?.payload && now - Date.parse(entry.refreshed_at || "") < interval) return { key: job.key, error: null };
    const upgradeSuccessfulLegacy = missingCountryMetadata && entry?.last_attempt_at === entry?.refreshed_at;
    if (!upgradeSuccessfulLegacy && entry && now - Date.parse(entry.last_attempt_at) < RETRY_MS) return { key: job.key, error: entry.payload ? null : "Provider retry scheduled" };
    try {
      const payload: PriceHistory | FundComposition = job.kind === "prices" ? await providers.prices(job.ticker, from) : await providers.holdings(job.ticker);
      if (job.kind === "holdings" && oldGeography && oldGeography.basis !== "unavailable" && (payload as FundComposition).geography?.basis === "unavailable") {
        throw new Error("Country provider unavailable; keeping the last valid composition and its date");
      }
      await database.insert(analyticsCache).values({ key: job.key, payload, refreshed_at: attemptedAt, last_attempt_at: attemptedAt }).onConflictDoUpdate({
        target: analyticsCache.key, set: { payload, refreshed_at: attemptedAt, last_attempt_at: attemptedAt },
      });
      return { key: job.key, error: null };
    } catch (error) {
      await database.insert(analyticsCache).values({ key: job.key, last_attempt_at: attemptedAt }).onConflictDoUpdate({ target: analyticsCache.key, set: { last_attempt_at: attemptedAt } });
      return { key: job.key, error: error instanceof Error ? error.message : "Provider unavailable" };
    }
  }));
}

export function analyticsStartDate(dates: (string | null)[], now = Date.now()) {
  const yearAgo = new Date(now); yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1); yearAgo.setUTCDate(yearAgo.getUTCDate() - 10);
  return dates.filter((date): date is string => Boolean(date) && Number.isFinite(Date.parse(date!))).map(date => date.slice(0, 10)).concat(yearAgo.toISOString().slice(0, 10)).sort()[0];
}
