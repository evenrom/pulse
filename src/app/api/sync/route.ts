export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { db } from '@/db';
import { assets, transactions, snapshots } from '@/db/schema';
import { calculateHoldings, calculateNetInvested } from '@/lib/finance';
import { eq } from 'drizzle-orm';

async function runSync() {
  // Fetch transactions and calculate holdings early
  const allTxs = await db.select().from(transactions);
  const holdings = calculateHoldings(allTxs);

  // 1. Fetch all assets
  const allAssets = await db.select().from(assets);
  if (!allAssets || allAssets.length === 0) {
    return { success: true, message: 'No assets found to sync.' };
  }

  // 2. Fetch prices from Yahoo Finance and update DB
  for (const asset of allAssets) {
    if (!asset.ticker) continue;

    // Filter assets: only fetch if holding > 0 or target_pct > 0
    const currentHolding = holdings[asset.ticker] || 0;
    const targetPct = asset.target_pct ?? 0;

    if (currentHolding <= 0 && targetPct <= 0) {
      continue;
    }

    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${asset.ticker}`
      );

      if (!response.ok) {
        console.error(`Failed to fetch quote for ${asset.ticker}. Status: ${response.status}`);
        continue;
      }

      const data = await response.json();

      const result = data.chart?.result?.[0];
      if (result && result.meta && typeof result.meta.regularMarketPrice === 'number') {
        const newPrice = result.meta.regularMarketPrice;
        await db.update(assets)
          .set({ current_price: newPrice, updated_at: Date.now().toString() })
          .where(eq(assets.ticker, asset.ticker));
      } else {
        console.error(`Invalid quote data for ${asset.ticker}:`, data);
      }
    } catch (err) {
      console.error(`Error updating price for ${asset.ticker}:`, err);
    }
  }

  // 3. Calculate new total market value and net invested
  const updatedAssets = await db.select().from(assets);

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

  return { success: true, message: 'Sync completed successfully.' };
}

export async function POST() {
  try {
    const result = await runSync();
    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    console.error('Sync API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) || 'Failed to sync market data' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const result = await runSync();
    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    console.error('Sync API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) || 'Failed to sync market data' },
      { status: 500 }
    );
  }
}
