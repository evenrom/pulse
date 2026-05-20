import { NextResponse, NextRequest } from "next/server";
import { validatePin } from "@/lib/auth";
import { db } from "@/db";
import { transactions, snapshots } from "@/db/schema";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { rebuildHistoricalSnapshots } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const pin = request.headers.get("x-pin");
    if (!pin || !validatePin(pin)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const filePath = path.join(process.cwd(), "src/lib/historical_transactions.json");
    const fileContents = await fs.readFile(filePath, "utf8");
    const jsonTransactions = JSON.parse(fileContents);

    // Wipe old data
    await db.delete(transactions);
    await db.delete(snapshots);

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
      historic_rate: Number(t.historic_rate) || 3.7,
      realized_pl: Number(t.realized_pl) || 0,
      created_at: new Date().toISOString(),
    }));

    if (insertData.length > 0) {
      await db.insert(transactions).values(insertData);
    }

    // Call shared utility to rebuild snapshots
    await rebuildHistoricalSnapshots(db);

    return NextResponse.json({ success: true, insertedTransactions: insertData.length });
  } catch (error) {
    console.error("Seed API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
