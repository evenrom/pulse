 import { db } from "@/db";
import { assets, transactions, snapshots } from "@/db/schema";
import { sql } from "drizzle-orm";

// HACK: Paste the newly generated Deployment URL below (Keep the ?sheetId=... parameter)
const LEGACY_API_URL = "https://script.google.com/macros/s/AKfycbwciilArcEvpTLRDE3NjCVSWopoAcjjkfc792ljbHs765nmHYy6dHDyW-dZnfUJitvO/exec?sheetId=1FdujyLqgYcKgaCPVzUsU7LYGBrVTJcvVEQd310_bWAQ&action=getPortfolio";

export async function migratePortfolio() {
  try {
    console.log("Fetching legacy portfolio data...");
    const response = await fetch(LEGACY_API_URL);

    if (!response.ok) {
      throw new Error(`API fetch error: ${response.status}`);
    }

    const payload = await response.json();

    if (payload.status !== 'success' || !payload.data || !payload.transactions) {
      throw new Error("Invalid data format. Did you update Code.gs and use the NEW deployment URL?");
    }

    const currentTimestamp = new Date().toISOString();

    console.log(`Received ${payload.data.length} assets and ${payload.transactions.length} transactions.`);

    // 1. Insert Assets
    if (payload.data.length > 0) {
      await db.insert(assets).values(
        payload.data.map((a: Record<string, unknown>) => ({
          ticker: String(a.Ticker),
          name: String(a.Name || ''),
          region: String(a.Region || 'Global'),
          sector: String(a.Sector || 'General'),
          asset_class: String(a.Asset_Class || 'Equity'),
          current_price: Number(a.Current_Price) || 0,
          target_pct: Number(a.Target_Pct) || 0,
          div_yield: Number(a.Div_Yield) || 0,
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

    // 2. Insert Transactions
    if (payload.transactions.length > 0) {
      await db.insert(transactions).values(
        payload.transactions.map((t: Record<string, unknown>) => {
          let dateStr = new Date().toISOString();
          try { if (t.Date) dateStr = new Date(t.Date as string).toISOString(); } catch{}

          return {
            id: String(t.ID || Math.random()),
            date: dateStr,
            ticker: String(t.Ticker || 'UNKNOWN'),
            action: (t.Action === 'BUY' || t.Action === 'SELL' || t.Action === 'DRIP') ? t.Action : 'BUY',
            quantity: Number(t.Quantity) || 0,
            price: Number(t.Price) || 0,
            fees: Number(t.Fees) || 0,
            total_amount: Number(t.Total_Amount) || 0,
            historic_rate: Number(t.USD_ILS_Rate) || 3.7,
            realized_pl: Number(t.Realized_PL) || 0,
            created_at: currentTimestamp,
          };
        })
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

    // 3. Reconstruct Snapshots (Golden Formula Implementation)
    console.log("Reconstructing snapshots...");
    const sortedTxs = [...payload.transactions].sort((a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime());
    const dates = Array.from(new Set(sortedTxs.map(t => {
        try { return new Date(t.Date as string).toISOString().split("T")[0]; }
        catch { return "1970-01-01"; }
    })));

    const snapshotValues = [];
    for (const date of dates) {
        const txsOnOrBeforeDate = sortedTxs.filter(t => {
           try { return new Date(t.Date as string).toISOString().split("T")[0] <= date; }
           catch { return false; }
        });
        
        let currentCost = 0;
        let realizedGains = 0;
        for (const tx of txsOnOrBeforeDate) {
            if (tx.Action === "BUY" || tx.Action === "DRIP") {
                currentCost += (Number(tx.Total_Amount) || 0);
            } else if (tx.Action === "SELL") {
                currentCost -= (Number(tx.Total_Amount) || 0);
            }
            realizedGains += (Number(tx.Realized_PL) || 0);
        }
        const netInvested = currentCost - realizedGains;

        snapshotValues.push({
            date,
            total_value: 0,
            net_invested: netInvested,
        });
    }

    if (snapshotValues.length > 0) {
        await db.insert(snapshots).values(snapshotValues).onConflictDoUpdate({
            target: snapshots.date,
            set: { net_invested: sql`excluded.net_invested` }
        });
        console.log(`Reconstructed ${snapshotValues.length} snapshots successfully.`);
    }

    return { success: true, message: "Migration completed successfully." };
  } catch (error) {
    console.error("Migration failed:", error);
    return { success: false, error: (error as Error).message };
  }
}

migratePortfolio().then(res => {
  console.log("Migration Result:", res);
  process.exit(0);
}).catch(err => {
  console.error("Migration Fatal Error:", err);
  process.exit(1);
});