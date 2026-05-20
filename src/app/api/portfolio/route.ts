import { NextResponse } from "next/server";
import { db } from "@/db";
import { assets, transactions, snapshots } from "@/db/schema";
import { asc } from "drizzle-orm";
import { validatePin } from "@/lib/auth";
import {
  calculateNetInvested,
  calculateHoldings,
  calculateProfitMetrics
} from "@/lib/finance";

// Force dynamic execution for this route to prevent Next.js from prerendering it statically.
export const dynamic = "force-dynamic";

// A public API for latest exchange rates (example: fallback to 1 USD = 3.7 ILS if API fails)
const EXCHANGE_RATE_API_URL = "https://api.exchangerate-api.com/v4/latest/USD";
const DEFAULT_USD_ILS = 3.7;

export async function GET(request: Request) {
  try {
    // 1. PIN Validation
    const pin = request.headers.get("x-pin");
    if (!pin || !validatePin(pin)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Fetch data from Turso
    const allAssets = await db.select().from(assets);
    const allTransactions = await db.select().from(transactions);
    const allSnapshots = await db.select().from(snapshots).orderBy(asc(snapshots.date));

    // 3. Calculate Exchange Rate
    let exchangeRate = DEFAULT_USD_ILS;
    try {
      const exRes = await fetch(EXCHANGE_RATE_API_URL, { cache: "no-store" });
      if (exRes.ok) {
        const exData = await exRes.json();
        if (exData && exData.rates && exData.rates.ILS) {
          exchangeRate = exData.rates.ILS;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch live exchange rate, using default.", e);
    }

    // 4. Calculate Aggregate Metrics
    const holdings = calculateHoldings(allTransactions);

    // Group transactions by ticker for O(1) lookup
    const transactionsByTicker = new Map<string, typeof allTransactions>();
    for (const tx of allTransactions) {
      if (!tx.ticker) continue;
      if (!transactionsByTicker.has(tx.ticker)) {
        transactionsByTicker.set(tx.ticker, []);
      }
      transactionsByTicker.get(tx.ticker)!.push(tx);
    }

    let totalMarketValueUsd = 0;
    const enrichedAssets = allAssets.map(asset => {
      const quantity = holdings[asset.ticker] || 0;
      const valueUsd = quantity * (asset.current_price || 0);
      totalMarketValueUsd += valueUsd;

      const assetTransactions = transactionsByTicker.get(asset.ticker) || [];

      const netInvestedAssetUsd = calculateNetInvested(assetTransactions);
      const profitMetricsAssetUsd = calculateProfitMetrics(assetTransactions, valueUsd, netInvestedAssetUsd);

      const netInvestedAssetIls = calculateNetInvested(assetTransactions, true);
      const profitMetricsAssetIls = calculateProfitMetrics(assetTransactions, valueUsd * exchangeRate, netInvestedAssetIls, true);

      const totalProfitPctUsd = netInvestedAssetUsd > 0 ? (profitMetricsAssetUsd.netProfit / netInvestedAssetUsd) * 100 : 0;
      const totalProfitPctIls = netInvestedAssetIls > 0 ? (profitMetricsAssetIls.netProfit / netInvestedAssetIls) * 100 : 0;

      return {
        ...asset,
        target_pct: asset.target_pct || 0,
        quantity,
        value_usd: valueUsd,
        value_ils: valueUsd * exchangeRate,
        capital_profit_usd: profitMetricsAssetUsd.capitalProfit,
        capital_profit_ils: profitMetricsAssetIls.capitalProfit,
        drip_usd: profitMetricsAssetUsd.totalDrip,
        drip_ils: profitMetricsAssetIls.totalDrip,
        total_profit_pct: totalProfitPctUsd, // Will be deprecated in UI
        total_profit_pct_usd: totalProfitPctUsd,
        total_profit_pct_ils: totalProfitPctIls,
      };
    });

    const netInvestedUsd = calculateNetInvested(allTransactions);
    const profitMetricsUsd = calculateProfitMetrics(allTransactions, totalMarketValueUsd, netInvestedUsd);

    const netInvestedIls = calculateNetInvested(allTransactions, true);
    const profitMetricsIls = calculateProfitMetrics(allTransactions, totalMarketValueUsd * exchangeRate, netInvestedIls, true);

    // 5. Apply Currency Lens (Convert USD metrics to ILS, except Net Invested & Profit which are historic)
    const metrics = {
      usd: {
        totalMarketValue: totalMarketValueUsd,
        netInvested: netInvestedUsd,
        capitalProfit: profitMetricsUsd.capitalProfit,
        totalDrip: profitMetricsUsd.totalDrip,
        totalRealizedGains: profitMetricsUsd.totalRealizedGains,
        netProfit: profitMetricsUsd.netProfit,
      },
      ils: {
        totalMarketValue: totalMarketValueUsd * exchangeRate,
        netInvested: netInvestedIls,
        capitalProfit: profitMetricsIls.capitalProfit,
        totalDrip: profitMetricsIls.totalDrip,
        totalRealizedGains: profitMetricsIls.totalRealizedGains,
        netProfit: profitMetricsIls.netProfit,
      },
      exchangeRate
    };

    // 6. Calculate History (Return %)
    const history = allSnapshots.map(snap => {
      const { date, total_value, net_invested } = snap;
      const val = Number(total_value || 0);
      const inv = Number(net_invested || 0);
      const return_pct = inv > 0 ? ((val - inv) / inv) * 100 : 0;
      return {
        date,
        return_pct
      };
    });

    return NextResponse.json({
      metrics,
      assets: enrichedAssets,
      history,
    });
  } catch (error) {
    console.error("Portfolio API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
