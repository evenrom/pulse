import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, snapshots } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { validatePin } from "@/lib/auth";
import { calculateNetInvested } from "@/lib/finance";

// Force dynamic execution for this route to prevent Next.js from prerendering it statically.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // 1. PIN Validation
    const pin = request.headers.get("x-pin");
    if (!pin || !validatePin(pin)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Fetch data
    const allSnapshots = await db.select().from(snapshots).orderBy(asc(snapshots.date));
    const allTransactions = await db.select().from(transactions).orderBy(asc(transactions.date));

    let updatedCount = 0;
    const logs: Array<{ date: string; old_net_invested: number; new_net_invested: number }> = [];

    // 3. Process each snapshot date
    for (const snapshot of allSnapshots) {
      if (!snapshot.date) continue;

      // Filter transactions ON or BEFORE the snapshot date
      const filteredTransactions = allTransactions.filter(
        tx => tx.date && tx.date <= snapshot.date
      );

      // Calculate corrected net invested
      const correctedNetInvested = calculateNetInvested(filteredTransactions);

      // Compare to see if we need to update (optional optimization)
      const oldNetInvested = snapshot.net_invested ?? 0;

      // Update the snapshot in DB
      await db.update(snapshots)
        .set({ net_invested: correctedNetInvested })
        .where(eq(snapshots.date, snapshot.date));

      updatedCount++;
      logs.push({
        date: snapshot.date,
        old_net_invested: oldNetInvested,
        new_net_invested: correctedNetInvested
      });
    }

    return NextResponse.json({
      success: true,
      updatedCount,
      logs,
    });

  } catch (error) {
    console.error("Migrate Snapshots API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
