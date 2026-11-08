import { ne, notInArray, and, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { assets } from "../db/schema";

const PLAN = [
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", target_pct: 0.35 },
  { ticker: "IDEV", name: "iShares Core MSCI International Developed Markets ETF", target_pct: 0.15 },
  { ticker: "FLAX", name: "Franklin FTSE Asia ex Japan ETF", target_pct: 0.05 },
  { ticker: "SGOV", name: "iShares 0-3 Month Treasury Bond ETF", target_pct: 0.40 },
  { ticker: "IAU", name: "iShares Gold Trust", target_pct: 0.05 },
];

const targets = new Map(PLAN.map(asset => [asset.ticker, asset.target_pct]));

export async function loadPortfolioAssets(db: LibSQLDatabase) {
  const rows = await db.select().from(assets);
  const existing = new Set(rows.map(asset => asset.ticker));
  const needsUpdate = PLAN.some(asset => !existing.has(asset.ticker))
    || rows.some(asset => (asset.target_pct ?? 0) !== (targets.get(asset.ticker) ?? 0));
  if (!needsUpdate) return rows;

  // Apply the plan together so readers never see a mixture of old and new targets.
  await db.batch([
    db.insert(assets).values(PLAN).onConflictDoUpdate({
      target: assets.ticker,
      set: { target_pct: sql`excluded.target_pct` },
    }),
    db.update(assets).set({ target_pct: 0 }).where(and(
      notInArray(assets.ticker, PLAN.map(asset => asset.ticker)),
      ne(assets.target_pct, 0),
    )),
  ]);
  return db.select().from(assets);
}
