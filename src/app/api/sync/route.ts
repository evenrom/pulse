export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { db } from '@/db';
import { assets, transactions, snapshots } from '@/db/schema';
import { calculateHoldings, calculateNetInvested } from '@/lib/finance';
import { eq } from 'drizzle-orm';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST() {
  try {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) {
      throw new Error('ALPHA_VANTAGE_API_KEY is missing.');
    }

    // 1. Fetch all assets
    const allAssets = await db.select().from(assets);
    if (!allAssets || allAssets.length === 0) {
      return NextResponse.json({ success: true, message: 'No assets found to sync.' }, { status: 200 });
    }

    // 2. Fetch prices from Alpha Vantage and update DB
    for (const asset of allAssets) {
      if (!asset.ticker) continue;

      try {
        const response = await fetch(
          `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${asset.ticker}&apikey=${apiKey}`
        );

        if (!response.ok) {
          console.error(`Failed to fetch quote for ${asset.ticker}. Status: ${response.status}`);
          continue;
        }

        const data = await response.json();
        const quote = data['Global Quote'];

        if (quote && quote['05. price']) {
          const newPrice = parseFloat(quote['05. price']);
          await db.update(assets)
            .set({ current_price: newPrice, updated_at: Date.now().toString() })
            .where(eq(assets.ticker, asset.ticker));
        } else {
          console.error(`Invalid quote data for ${asset.ticker}:`, data);
        }
      } catch (err) {
        console.error(`Error updating price for ${asset.ticker}:`, err);
      }

      // Delay to respect rate limits (5 per min -> 12s per req)
      await delay(12000);
    }

    // 3. Calculate new total market value and net invested
    const updatedAssets = await db.select().from(assets);
    const allTxs = await db.select().from(transactions);

    const holdings = calculateHoldings(allTxs);
    let totalMarketValue = 0;

    for (const asset of updatedAssets) {
      if (asset.ticker && asset.current_price && holdings[asset.ticker]) {
        totalMarketValue += asset.current_price * holdings[asset.ticker];
      }
    }

    const netInvested = calculateNetInvested(allTxs);

    // 4. Update snapshot
    const today = new Date().toISOString().split('T')[0];
    const existingSnapshot = await db.select().from(snapshots).where(eq(snapshots.date, today));

    if (existingSnapshot.length > 0) {
      await db.update(snapshots)
        .set({ total_value: totalMarketValue, net_invested: netInvested })
        .where(eq(snapshots.date, today));
    } else {
      await db.insert(snapshots).values({
        date: today,
        total_value: totalMarketValue,
        net_invested: netInvested,
      });
    }

    return NextResponse.json({ success: true, message: 'Sync completed successfully.' }, { status: 200 });
  } catch (error: unknown) {
    console.error('Sync API Error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) || 'Failed to sync market data' }, { status: 500 });
  }
}
