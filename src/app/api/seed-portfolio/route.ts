import { NextResponse, NextRequest } from "next/server";
import { validatePin } from "@/lib/auth";
import { db } from "@/db";
import { transactions, snapshots } from "@/db/schema";
import crypto from "crypto";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const DEFAULT_HISTORIC_RATE = 3.7;

export async function POST(request: NextRequest) {
  try {
    const pin = request.headers.get("x-pin");
    if (!pin || !validatePin(pin)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const jsonTransactions = (await import("@/lib/historical_transactions.json")).default;
    const jsonSnapshots = (await import("@/lib/snapshots.json")).default;

    if (!Array.isArray(jsonTransactions) || !Array.isArray(jsonSnapshots)) {
      return NextResponse.json({ error: "Invalid JSON format: expected an array" }, { status: 400 });
    }

    let insertedCount = 0;

    try {
      await db.transaction(async (tx) => {
        // Wipe old data
        await tx.delete(transactions);
        await tx.delete(snapshots);

        // Map to db schema and insert
        const insertData = [];
        const rateCache: Record<string, number> = {};

        for (const t of jsonTransactions as Record<string, unknown>[]) {
          const txDate = typeof t.date === "string" ? t.date : new Date().toISOString();
          const dateOnly = txDate.slice(0, 10);
          let dynamicRate = DEFAULT_HISTORIC_RATE;

          if (rateCache[dateOnly]) {
            dynamicRate = rateCache[dateOnly];
          } else {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            try {
              const res = await fetch(`https://api.frankfurter.app/${dateOnly}?from=USD&to=ILS`, {
                cache: 'force-cache',
                signal: controller.signal
              });

              if (res.ok) {
                const data = await res.json();
                dynamicRate = data.rates?.ILS || DEFAULT_HISTORIC_RATE;
                rateCache[dateOnly] = dynamicRate;
              } else {
                console.warn(`Failed to fetch rate for ${dateOnly}. Status: ${res.status}. Using fallback.`);
              }
            } catch (error) {
              console.warn(`Error fetching rate for ${dateOnly}:`, error, 'Using fallback.');
            } finally {
              clearTimeout(timeoutId);
            }
          }

          insertData.push({
            id: crypto.randomUUID(),
            date: txDate,
            ticker: typeof t.ticker === "string" ? t.ticker : "UNKNOWN",
            action: ["BUY", "SELL", "DRIP"].includes(t.action as string) ? (t.action as "BUY" | "SELL" | "DRIP") : "BUY",
            quantity: Number(t.quantity) || 0,
            price: Number(t.price) || 0,
            fees: Number(t.fees) || 0,
            total_amount: Number(t.total_amount) || 0,
            historic_rate: dynamicRate,
            realized_pl: Number(t.realized_pl) || 0,
            created_at: new Date().toISOString(),
          });
        }

        if (insertData.length > 0) {
          await tx.insert(transactions).values(insertData);
          insertedCount = insertData.length;
        }

        const snapshotInsertData = (jsonSnapshots as Record<string, unknown>[]).map((s) => ({
          date: String(s.date),
          total_value: Number(s.total_value),
          net_invested: Number(s.net_invested)
        }));

        if (snapshotInsertData.length > 0) {
          await tx.insert(snapshots).values(snapshotInsertData).onConflictDoUpdate({
            target: snapshots.date,
            set: {
              total_value: sql`excluded.total_value`,
              net_invested: sql`excluded.net_invested`
            }
          });
        }
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