import { NextResponse } from "next/server";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { validatePin } from "@/lib/auth";

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

    const { ticker, action, date, quantity, price, fees } = body;

    if (!ticker || typeof ticker !== "string") {
      return NextResponse.json({ error: "Invalid or missing ticker" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (!["BUY", "SELL", "DRIP"].includes(action)) {
      return NextResponse.json({ error: "Invalid or missing action. Must be BUY, SELL, or DRIP." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid or missing date. Must be YYYY-MM-DD." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (typeof quantity !== "number" || quantity < 0) {
      return NextResponse.json({ error: "Invalid or negative quantity" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (typeof price !== "number" || price < 0) {
      return NextResponse.json({ error: "Invalid or negative price" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }

    if (typeof fees !== "number" || fees < 0) {
      return NextResponse.json({ error: "Invalid or negative fees" }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
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
    const createdAt = Math.floor(Date.now() / 1000).toString(); // Unix timestamp in seconds
    const realizedPl = 0; // Default for BUY/DRIP

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
      { success: true, id: txId },
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
