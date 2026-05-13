import { db } from "@/db";
import { assets, transactions, snapshots } from "@/db/schema";
import { calculateNetInvested } from "@/lib/finance";
import { sql } from "drizzle-orm";

const LEGACY_API_URL = "https://script.google.com/macros/s/AKfycbxHpb8GbPx8rtpvndKhT420Rt1GZ_zoL26gjzlY45U6/exec?sheetId=1FdujyLqgYcKgaCPVzUsU7LYGBrVTJcvVEQd310_bWAQ&scriptId=1rlvPktMB6ZbCcrGmxow6ugYuyYnBBSnFMTqETI9Z8rZYOcIEWbXGDtVw&action=getPortfolio";

interface LegacyAsset {
  ticker: string;
  name: string;
  region: string;
  sector: string;
  asset_class: string;
  current_price: number;
  target_pct: number;
  div_yield: number;
}

interface LegacyTransaction {
  id: string;
  date: string;
  ticker: string;
  action: "BUY" | "SELL" | "DRIP";
  quantity: number;
  price: number;
  fees: number;
  total_amount: number;
  historic_rate: number;
  realized_pl: number;
}

interface LegacyPortfolioResponse {
  assets: LegacyAsset[];
  transactions: LegacyTransaction[];
}

export async function migratePortfolio() {
  try {
    console.log("Fetching legacy portfolio data...");
    const response = await fetch(LEGACY_API_URL);

    if (!response.ok) {
      throw new Error(`API fetch error: ${response.status} ${response.statusText}`);
    }

    const dataText = await response.text();
    let data: LegacyPortfolioResponse;
    try {
      data = JSON.parse(dataText);
    } catch {
      // Sometimes it might return an HTML page or unexpected data if there's an error.
      console.error("Failed to parse JSON response:", dataText.substring(0, 200));
      throw new Error("Failed to parse legacy API response as JSON.");
    }

    if (!data || !data.assets || !data.transactions) {
      throw new Error("Invalid data format received from API.");
    }

    const currentTimestamp = Date.now().toString();

    console.log(`Received ${data.assets.length} assets and ${data.transactions.length} transactions.`);

    // 1. Insert Assets
    try {
      if (data.assets.length > 0) {
        await db.insert(assets).values(
          data.assets.map(a => ({
            ...a,
            updated_at: currentTimestamp,
          }))
        ).onConflictDoUpdate({
          target: assets.ticker,
          set: {
            name: sql`excluded.name`,
            region: sql`excluded.region`,
            sector: sql`excluded.sector`,
            asset_class: sql`excluded.asset_class`,
            current_price: sql`excluded.current_price`,
            target_pct: sql`excluded.target_pct`,
            div_yield: sql`excluded.div_yield`,
            updated_at: currentTimestamp,
          }
        });
        console.log("Assets migrated successfully.");
      }
    } catch (e) {
      console.error("DB insertion error (assets):", e);
      throw e;
    }

    // 2. Insert Transactions
    try {
      if (data.transactions.length > 0) {
        await db.insert(transactions).values(
          data.transactions.map(t => ({
            ...t,
            created_at: currentTimestamp,
          }))
        ).onConflictDoUpdate({
          target: transactions.id,
          set: {
            date: sql`excluded.date`,
            ticker: sql`excluded.ticker`,
            action: sql`excluded.action`,
            quantity: sql`excluded.quantity`,
            price: sql`excluded.price`,
            fees: sql`excluded.fees`,
            total_amount: sql`excluded.total_amount`,
            historic_rate: sql`excluded.historic_rate`,
            realized_pl: sql`excluded.realized_pl`,
          }
        });
        console.log("Transactions migrated successfully.");
      }
    } catch (e) {
      console.error("DB insertion error (transactions):", e);
      throw e;
    }

    // 3. Reconstruct Snapshots
    try {
      console.log("Reconstructing snapshots...");
      // Sort transactions by date
      const sortedTxs = [...data.transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const dates = Array.from(new Set(sortedTxs.map(t => t.date.split("T")[0])));

      const snapshotValues = [];
      for (const date of dates) {
        // Find all txs up to and including this date
        // We'll just filter them simply
        const txsOnOrBeforeDate = sortedTxs.filter(t => t.date.split("T")[0] <= date);
        const netInvested = calculateNetInvested(txsOnOrBeforeDate as unknown as import("@/lib/finance").Transaction[]);

        snapshotValues.push({
          date,
          total_value: 0, // We don't have historical total_value easily without historical prices, might leave as 0 or calculate if possible
          net_invested: netInvested,
        });
      }

      if (snapshotValues.length > 0) {
        await db.insert(snapshots).values(snapshotValues).onConflictDoUpdate({
          target: snapshots.date,
          set: {
            net_invested: sql`excluded.net_invested`,
            // Total value should be calculated from historical prices, which we might not have, so keeping existing or 0
          }
        });
        console.log(`Reconstructed ${snapshotValues.length} snapshots successfully.`);
      }
    } catch (e) {
      console.error("DB insertion error (snapshots):", e);
      throw e;
    }

    return { success: true, message: "Migration completed successfully." };
  } catch (error) {
    console.error("Migration failed:", error);
    return { success: false, error: (error as Error).message };
  }
}
