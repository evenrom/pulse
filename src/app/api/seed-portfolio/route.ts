import { NextResponse, NextRequest } from "next/server";
import { validatePin } from "@/lib/auth";
import { db } from "@/db";
import { transactions, snapshots, assets } from "@/db/schema";
import crypto from "crypto";
import { rebuildHistoricalSnapshots } from "@/lib/finance";

export const dynamic = "force-dynamic";

const DEFAULT_HISTORIC_RATE = 3.7;

export async function POST(request: NextRequest) {
  try {
    const pin = request.headers.get("x-pin");
    if (!pin || !validatePin(pin)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const jsonTransactions = (await import("@/lib/historical_transactions.json")).default;

    if (!Array.isArray(jsonTransactions)) {
      return NextResponse.json({ error: "Invalid JSON format: expected an array" }, { status: 400 });
    }

    let insertedCount = 0;

    try {
      await db.transaction(async (tx) => {
        // Wipe old data
        await tx.delete(transactions);
        await tx.delete(snapshots);

        // Extract unique tickers
        const uniqueTickers = Array.from(
          new Set(
            jsonTransactions
              .map((t: Record<string, unknown>) => t.ticker)
              .filter((ticker): ticker is string => typeof ticker === "string")
          )
        );

        // Pre-seed missing assets to avoid FK constraints
        const uniqueAssetsData = uniqueTickers.map((ticker) => ({
          ticker: ticker,
          name: ticker,
          current_price: 0,
        }));

        if (uniqueAssetsData.length > 0) {
          await tx.insert(assets).values(uniqueAssetsData).onConflictDoNothing();
        }

        // Map to db schema and insert
        const insertData = jsonTransactions.map((t: Record<string, unknown>) => ({
          id: crypto.randomUUID(),
          date: typeof t.date === "string" ? t.date : new Date().toISOString(),
          ticker: typeof t.ticker === "string" ? t.ticker : "UNKNOWN",
          action: ["BUY", "SELL", "DRIP"].includes(t.action as string) ? (t.action as "BUY" | "SELL" | "DRIP") : "BUY",
          quantity: Number(t.quantity) || 0,
          price: Number(t.price) || 0,
          fees: Number(t.fees) || 0,
          total_amount: Number(t.total_amount) || 0,
          historic_rate: Number(t.historic_rate) || DEFAULT_HISTORIC_RATE,
          realized_pl: Number(t.realized_pl) || 0,
          created_at: new Date().toISOString(),
        }));

        if (insertData.length > 0) {
          await tx.insert(transactions).values(insertData);
          insertedCount = insertData.length;
        }

        // Call shared utility to rebuild snapshots using the transaction runner
        await rebuildHistoricalSnapshots(tx);
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("SEEDING_ERROR_DETAILED:", error);
      return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }

    return NextResponse.json({ success: true, insertedTransactions: insertedCount });
  } catch (error) {
    console.error("Seed API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
