export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { db } from '@/db';
import { transactions, assets } from '@/db/schema';
import { validatePin } from '@/lib/auth';
import { eq } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    // 1. PIN Validation
    const pin = req.headers.get('x-pin');
    if (!pin || !validatePin(pin)) {
      return NextResponse.json({ error: 'Unauthorized: Invalid or missing PIN' }, { status: 401 });
    }

    // 2. Parse payload
    const body = await req.json();
    const { ticker, action, quantity, price, fees, date } = body;

    if (!ticker || !action || quantity === undefined || price === undefined || fees === undefined || !date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['BUY', 'SELL', 'DRIP'].includes(action)) {
       return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // 3. Calculate total_amount
    const numQuantity = parseFloat(quantity);
    const numPrice = parseFloat(price);
    const numFees = parseFloat(fees);

    let totalAmount = 0;
    if (action === 'BUY' || action === 'DRIP') {
      totalAmount = (numQuantity * numPrice) + numFees;
    } else if (action === 'SELL') {
      totalAmount = (numQuantity * numPrice) - numFees;
    }

    // 4. Insert transaction
    const transactionId = crypto.randomUUID();
    await db.insert(transactions).values({
      id: transactionId,
      date,
      ticker,
      action,
      quantity: numQuantity,
      price: numPrice,
      fees: numFees,
      total_amount: totalAmount,
      historic_rate: null, // Assuming this is set elsewhere or later
      realized_pl: null, // Depending on calculation logic later
      created_at: Date.now().toString(),
    });

    // 5. Ensure asset placeholder exists
    const existingAsset = await db.select().from(assets).where(eq(assets.ticker, ticker));
    if (existingAsset.length === 0) {
      await db.insert(assets).values({
        ticker,
        name: ticker, // Placeholder
        region: 'Unknown',
        sector: 'Unknown',
        asset_class: 'Unknown',
        current_price: numPrice, // Best guess for now
        target_pct: null,
        div_yield: null,
        updated_at: Date.now().toString(),
      });
    }

    return NextResponse.json({ message: 'Trade successfully recorded', id: transactionId }, { status: 200 });

  } catch (error: unknown) {
    console.error('Trade API Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) || 'Failed to process trade' }, { status: 500 });
  }
}
