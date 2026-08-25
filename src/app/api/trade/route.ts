import { NextResponse } from "next/server";
import { db } from "@/db";
import { assets, transactions } from "@/db/schema";
import { validatePin } from "@/lib/auth";
import { calculateFifo } from "@/lib/fifo";

export const dynamic = "force-dynamic";

type TradeInput = { ticker?: unknown; action?: unknown; date?: unknown; quantity?: unknown; price?: unknown; fees?: unknown };
type ValidatedTrade = { ticker: string; action: "BUY" | "SELL" | "DRIP"; date: string; quantity: number; price: number; fees: number };

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0, must-revalidate" };

function validateTrade(input: TradeInput, index: number): ValidatedTrade | string {
  const prefix = `Row ${index + 1}:`;
  const ticker = typeof input.ticker === "string" ? input.ticker.trim().toUpperCase() : "";
  if (!ticker) return `${prefix} ticker is required.`;
  if (input.action !== "BUY" && input.action !== "SELL" && input.action !== "DRIP") return `${prefix} choose BUY, SELL, or DRIP.`;

  const date = typeof input.date === "string" ? input.date : "";
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return `${prefix} enter a valid date.`;
  }

  const quantity = Number(input.quantity);
  const price = Number(input.price);
  const fees = Number(input.fees ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return `${prefix} quantity must be greater than zero.`;
  if (!Number.isFinite(price) || price <= 0) return `${prefix} price must be greater than zero.`;
  if (!Number.isFinite(fees) || fees < 0) return `${prefix} fees cannot be negative.`;
  return { ticker, action: input.action, date, quantity, price, fees };
}

async function fetchHistoricRate(date: string): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=ILS`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`FX provider returned ${response.status}`);
    const data = await response.json();
    const rate = data?.rates?.ILS;
    if (typeof rate === "number" && rate >= 2 && rate <= 4.5) return rate;
    throw new Error("FX provider returned an invalid rate");
  } catch (error) {
    console.warn(`Historical FX lookup failed for ${date}; using 3.72.`, error);
    return 3.72;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  try {
    const pin = request.headers.get("x-pin");
    if (!pin || !validatePin(pin)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });

    let body: (TradeInput & { trades?: TradeInput[] }) | null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: noStoreHeaders });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid transaction payload." }, { status: 400, headers: noStoreHeaders });
    }
    const inputs = Array.isArray(body.trades) ? body.trades : [body];
    if (inputs.some(input => !input || typeof input !== "object")) {
      return NextResponse.json({ error: "Each transaction row must be an object." }, { status: 400, headers: noStoreHeaders });
    }
    if (inputs.length === 0 || inputs.length > 20) {
      return NextResponse.json({ error: "Submit between 1 and 20 transactions." }, { status: 400, headers: noStoreHeaders });
    }

    const validated: ValidatedTrade[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const result = validateTrade(inputs[index], index);
      if (typeof result === "string") return NextResponse.json({ error: result }, { status: 400, headers: noStoreHeaders });
      validated.push(result);
    }

    const allAssets = await db.select({ ticker: assets.ticker }).from(assets);
    const knownTickers = new Set(allAssets.map(asset => asset.ticker));
    const unknown = validated.find(trade => !knownTickers.has(trade.ticker));
    if (unknown) return NextResponse.json({ error: `Unknown ticker ${unknown.ticker}.` }, { status: 400, headers: noStoreHeaders });

    const ratePromises = new Map<string, Promise<number>>();
    for (const trade of validated) if (!ratePromises.has(trade.date)) ratePromises.set(trade.date, fetchHistoricRate(trade.date));
    const rates = new Map<string, number>();
    await Promise.all(Array.from(ratePromises.entries()).map(async ([date, promise]) => rates.set(date, await promise)));

    const createdAt = Date.now();
    const pending = validated.map((trade, index) => ({
      id: crypto.randomUUID(),
      ...trade,
      total_amount: trade.action === "SELL" ? (trade.quantity * trade.price) - trade.fees : (trade.quantity * trade.price) + trade.fees,
      historic_rate: rates.get(trade.date) || 3.72,
      realized_pl: 0,
      created_at: String(createdAt + index),
    }));

    const existing = await db.select().from(transactions);
    const fifo = calculateFifo([...existing, ...pending]);
    if (fifo.issues.length > 0) {
      const pendingIds = new Set(pending.map(tx => tx.id));
      const issue = fifo.issues.find(item => pendingIds.has(item.transactionId)) || fifo.issues[0];
      return NextResponse.json({ error: issue.message }, { status: 400, headers: noStoreHeaders });
    }

    const realizedById = new Map(fifo.sales.map(sale => [sale.transactionId, sale.realizedProfit]));
    const values = pending.map(tx => ({ ...tx, realized_pl: realizedById.get(tx.id) || 0 }));

    // One bulk statement keeps the batch all-or-nothing.
    await db.insert(transactions).values(values);

    return NextResponse.json({
      success: true,
      count: values.length,
      transactions: values.map(tx => ({ id: tx.id, ticker: tx.ticker, action: tx.action, realizedProfit: tx.realized_pl })),
    }, { headers: noStoreHeaders });
  } catch (error) {
    console.error("Trade API internal error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: noStoreHeaders });
  }
}
