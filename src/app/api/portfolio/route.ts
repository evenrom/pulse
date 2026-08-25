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
    let exchangeRate = 3.72; // ברירת מחדל ריאלית להיום במקום 3.7 היבש
    try {
      // מעבר ל-API אמין יותר והוראה אגרסיבית ל-Next.js לא לשמור Cache בשום מצב
      const exRes = await fetch("https://open.er-api.com/v6/latest/USD", { 
        cache: "no-store",
        next: { revalidate: 0 } 
      });
      
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
        total_profit_usd: profitMetricsAssetUsd.netProfit,
        total_profit_ils: profitMetricsAssetIls.netProfit,
        realized_profit_usd: profitMetricsAssetUsd.totalRealizedGains,
        realized_profit_ils: profitMetricsAssetIls.totalRealizedGains,
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
      const transactionsThroughDate = allTransactions.filter(tx => date && tx.date && String(tx.date).slice(0, 10) <= date);
      const realizedUsd = transactionsThroughDate.reduce((sum, tx) => sum + Number(tx.realized_pl || 0), 0);
      const dripUsd = transactionsThroughDate
        .filter(tx => tx.action === "DRIP")
        .reduce((sum, tx) => sum + Number(tx.total_amount || 0), 0);
      const netInvestedIlsAtDate = calculateNetInvested(transactionsThroughDate, true);
      const realizedIls = transactionsThroughDate.reduce((sum, tx) => sum + (Number(tx.realized_pl || 0) * Number(tx.historic_rate || 1)), 0);
      const dripIls = transactionsThroughDate
        .filter(tx => tx.action === "DRIP")
        .reduce((sum, tx) => sum + (Number(tx.total_amount || 0) * Number(tx.historic_rate || 1)), 0);
      const totalValueIls = val * exchangeRate;
      const profitUsd = val + realizedUsd - inv;
      const profitIls = totalValueIls + realizedIls - netInvestedIlsAtDate;
      return {
        date,
        return_pct_usd: inv > 0 ? (profitUsd / inv) * 100 : 0,
        return_pct_ils: netInvestedIlsAtDate > 0 ? (profitIls / netInvestedIlsAtDate) * 100 : 0,
        total_value_usd: val,
        total_value_ils: totalValueIls,
        net_invested_usd: inv,
        net_invested_ils: netInvestedIlsAtDate,
        total_profit_usd: profitUsd,
        total_profit_ils: profitIls,
        drip_usd: dripUsd,
        drip_ils: dripIls,
        realized_usd: realizedUsd,
        realized_ils: realizedIls,
      };
    });

    const parseUpdatedAt = (value: string | number | null): number | null => {
      if (value == null) return null;
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        return numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
      }
      const parsed = Date.parse(String(value));
      return Number.isFinite(parsed) ? parsed : null;
    };

    const activeAssets = enrichedAssets.filter(asset => asset.quantity > 0 || asset.target_pct > 0);
    const staleThreshold = Date.now() - (72 * 60 * 60 * 1000);
    const staleTickers = activeAssets
      .filter(asset => {
        const updatedAt = parseUpdatedAt(asset.updated_at);
        return updatedAt == null || updatedAt < staleThreshold;
      })
      .map(asset => asset.ticker);
    const latestUpdate = activeAssets
      .map(asset => parseUpdatedAt(asset.updated_at))
      .filter((value): value is number => value != null)
      .sort((a, b) => b - a)[0] || null;

    const transactionHistory = [...allTransactions]
      .sort((a, b) => {
        const dateDifference = String(b.date || "").localeCompare(String(a.date || ""));
        if (dateDifference !== 0) return dateDifference;
        return Number(b.created_at || 0) - Number(a.created_at || 0);
      })
      .map(tx => ({
        id: tx.id,
        date: tx.date,
        ticker: tx.ticker,
        action: tx.action,
        quantity: tx.quantity,
        price: tx.price,
        fees: tx.fees,
        total_amount: tx.total_amount,
        historic_rate: tx.historic_rate,
        realized_pl: tx.realized_pl,
      }));

    return NextResponse.json({
      metrics,
      assets: enrichedAssets,
      history,
      transactions: transactionHistory,
      operationalStatus: {
        lastPriceUpdate: latestUpdate ? new Date(latestUpdate).toISOString() : null,
        staleTickers,
        activeAssetCount: activeAssets.length,
      },
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate"
      }
    });
  } catch (error) {
    console.error("Portfolio API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
