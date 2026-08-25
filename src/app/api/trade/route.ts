import { NextResponse } from "next/server";
import { db } from "@/db";
import { assets, transactions } from "@/db/schema";
import { validatePin } from "@/lib/auth";
import { calculateFifo } from "@/lib/fifo";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    // 1. PIN Validation
    const pin = request.headers.get("x-pin");
    if (!pin || !validatePin(pin)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    // 2. Parse and Validate Payload
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    const { action, date, quantity, price, fees } = body;
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";

    if (!ticker) {
      return NextResponse.json({ error: "Invalid or missing ticker" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (!["BUY", "SELL", "DRIP"].includes(action)) {
      return NextResponse.json({ error: "Invalid or missing action. Must be BUY, SELL, or DRIP." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    const parsedDate = typeof date === "string" ? new Date(`${date}T00:00:00.000Z`) : null;
    const isValidDate = parsedDate && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidDate) {
      return NextResponse.json({ error: "Invalid or missing date. Must be YYYY-MM-DD." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Quantity must be greater than zero" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Price must be greater than zero" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (typeof fees !== "number" || !Number.isFinite(fees) || fees < 0) {
      return NextResponse.json({ error: "Invalid or negative fees" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    const matchingAsset = await db.select({ ticker: assets.ticker }).from(assets).where(eq(assets.ticker, ticker));
    if (matchingAsset.length === 0) {
      return NextResponse.json({ error: `Unknown ticker ${ticker}. Add it to assets before recording a transaction.` }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    // 3. Calculate Total Amount
    let totalAmount = (quantity * price) + fees;
    if (action === "SELL") {
      totalAmount = (quantity * price) - fees;
    }

    // 4. Fetch Historical Exchange Rate
    let historicRate = 3.72; // Default
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const exRes = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=ILS`, {
          signal: controller.signal,
          cache: "no-store"
        });

        if (exRes.ok) {
          const exData = await exRes.json();
          if (exData && exData.rates && typeof exData.rates.ILS === "number") {
            const fetchedRate = exData.rates.ILS;
            if (fetchedRate >= 2.0 && fetchedRate <= 4.5) {
              historicRate = fetchedRate;
            } else {
              console.warn(`Fetched exchange rate ${fetchedRate} is out of bounds [3.0, 4.5]. Using fallback 3.72.`);
            }
          }
        } else {
          throw new Error(`Exchange rate API responded with status ${exRes.status}`);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      console.warn("Failed to fetch historic exchange rate, using fallback 3.72.", e);
    }

    // 5. Data Integrity & Database Insertion
    const txId = crypto.randomUUID();
    const createdAt = Date.now().toString();
    let realizedPl = 0;

    const existingTransactions = await db.select().from(transactions);
    const fifoResult = calculateFifo([
      ...existingTransactions,
      {
        id: txId,
        date,
        ticker,
        action: action as "BUY" | "SELL" | "DRIP",
        quantity,
        price,
        fees,
        total_amount: totalAmount,
        created_at: createdAt,
      },
    ]);

    if (fifoResult.issues.length > 0) {
      const relevantIssue = fifoResult.issues.find((issue) => issue.transactionId === txId) || fifoResult.issues[0];
      return NextResponse.json({ error: relevantIssue.message }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (action === "SELL") {
      const fifoSale = fifoResult.sales.find((sale) => sale.transactionId === txId);
      if (!fifoSale) {
        return NextResponse.json({ error: "Unable to calculate FIFO result for this sale." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
      }
      realizedPl = fifoSale.realizedProfit;
    }

    await db.insert(transactions).values({
      id: txId,
      date,
      ticker,
      action: action as "BUY" | "SELL" | "DRIP",
      quantity,
      price,
      fees,
      total_amount: totalAmount,
      historic_rate: historicRate,
      realized_pl: realizedPl,
      created_at: createdAt
    });

    return NextResponse.json(
      { success: true, id: txId, realizedProfit: realizedPl },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate"
        }
      }
    );

  } catch (error) {
    console.error("Trade API internal error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0, must-revalidate"
        }
      }
    );
  }
}
