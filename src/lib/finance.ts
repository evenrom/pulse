import { transactions, assets, snapshots } from "@/db/schema";
import { InferSelectModel, sql } from "drizzle-orm";

export type Transaction = InferSelectModel<typeof transactions>;
export type Asset = InferSelectModel<typeof assets>;

/**
 * Consolidated function to compute all asset metrics in a single pass.
 * Calculates Net Invested, Total DRIP, Realized Gains, Capital Profit, and Net Profit.
 *
 * @param txs List of transactions
 * @param marketValue Total Market Value
 * @param useHistoricRate If true, applies tx.historic_rate to calculations
 * @returns Object with netInvested, capitalProfit, totalDrip, totalRealizedGains, and netProfit
 */
export function calculateAssetMetrics(txs: Transaction[], marketValue: number, useHistoricRate = false) {
  let netInvested = 0;
  let totalRealizedGains = 0;
  let totalDrip = 0;

  for (const tx of txs) {
    const rate = useHistoricRate ? (tx.historic_rate || 1) : 1;
    const amount = Math.abs(Number(tx.total_amount || 0)) * rate;

    if (tx.action === "BUY") {
      netInvested += amount;
    } else if (tx.action === "SELL") {
      const costBasis = amount - ((tx.realized_pl || 0) * rate);
      netInvested -= costBasis;
    } else if (tx.action === "DRIP") {
      totalDrip += amount;
    }

    totalRealizedGains += (tx.realized_pl || 0) * rate;
  }

  const netProfit = (marketValue + totalRealizedGains) - netInvested;
  const capitalProfit = netProfit - totalDrip - totalRealizedGains;

  return {
    netInvested,
    capitalProfit,
    totalDrip,
    totalRealizedGains,
    netProfit
  };
}

/**
 * Calculate Net Invested based on the Golden Formula:
 * Net Invested = Current Cost - Realized Gains
 * @param txs List of transactions
 * @param useHistoricRate If true, applies tx.historic_rate to calculations
 * @returns Total Net Invested
 */
export function calculateNetInvested(txs: Transaction[], useHistoricRate = false): number {
  return calculateAssetMetrics(txs, 0, useHistoricRate).netInvested;
}

/**
 * Calculates Total Return and Total Return Percentage
 * @param capitalProfit The capital profit amount
 * @param drip The reinvested DRIP amount
 * @param currentValue The current value of the asset
 * @returns Object with totalReturn and totalReturnPct
 */
export function calculateTotalReturnMetrics(capitalProfit: number, drip: number, currentValue: number) {
  const totalReturn = capitalProfit + drip;
  const netInvested = currentValue - capitalProfit;
  const totalReturnPct = netInvested > 0 ? (totalReturn / netInvested) * 100 : 0;

  return {
    totalReturn,
    totalReturnPct,
    netInvested
  };
}

/**
 * Calculate ROI (Time-weighted return)
 * ROI = (Total Market Value - Net Invested) / Net Invested
 * @param marketValue Total Market Value
 * @param netInvested Total Net Invested
 * @returns ROI as a decimal percentage
 */
export function calculateROI(marketValue: number, netInvested: number): number {
  if (netInvested === 0) return 0;
  return (marketValue - netInvested) / netInvested;
}

/**
 * Calculate current holdings (quantities) per ticker from transactions
 * @param txs List of transactions
 * @returns Map of ticker to quantity
 */
export function calculateHoldings(txs: Transaction[]): Record<string, number> {
  const holdings: Record<string, number> = {};

  for (const tx of txs) {
    if (!tx.ticker || tx.quantity == null) continue;

    if (!holdings[tx.ticker]) {
      holdings[tx.ticker] = 0;
    }

    if (tx.action === "BUY" || tx.action === "DRIP") {
      holdings[tx.ticker] += tx.quantity;
    } else if (tx.action === "SELL") {
      holdings[tx.ticker] -= tx.quantity;
    }
  }

  return holdings;
}

/**
 * Calculate Capital Profit and DRIP totals
 * @param txs List of transactions
 * @param marketValue Total Market Value
 * @param netInvested Total Net Invested
 * @param useHistoricRate If true, applies tx.historic_rate to DRIP and realized gains
 * @returns Object with capitalProfit and drip totals
 */
export function calculateProfitMetrics(txs: Transaction[], marketValue: number, netInvested: number, useHistoricRate = false) {
  // Since calculateAssetMetrics now derives netInvested, we only pass marketValue to it to get the correct metrics.
  // The provided netInvested argument is not used internally for profit calculation anymore, keeping signature backward compatible.
  const metrics = calculateAssetMetrics(txs, marketValue, useHistoricRate);

  return {
    capitalProfit: metrics.capitalProfit,
    totalDrip: metrics.totalDrip,
    totalRealizedGains: metrics.totalRealizedGains,
    netProfit: metrics.netProfit
  };
}

/**
 * Centralized utility to rebuild historical snapshots for every distinct
 * transaction date based on the current transactions in the database.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rebuildHistoricalSnapshots(db: any) {
  const allTxs = (await db.select().from(transactions)) as Transaction[];
  const allAssets = await db.select().from(assets);

  const sortedTxs = [...allTxs].sort((a, b) => new Date(a.date || "").getTime() - new Date(b.date || "").getTime());
  const dates = Array.from(new Set(sortedTxs.map(t => {
      try { return new Date(t.date || "").toISOString().split("T")[0]; }
      catch { return "1970-01-01"; }
  })));

  const snapshotValues = [];
  for (const date of dates) {
    const txsOnOrBeforeDate = sortedTxs.filter(t => {
       try { return new Date(t.date || "").toISOString().split("T")[0] <= date; }
       catch { return false; }
    });

    const netInvested = calculateNetInvested(txsOnOrBeforeDate);
    const holdings = calculateHoldings(txsOnOrBeforeDate);

    let totalMarketValue = 0;
    for (const asset of allAssets) {
      if (asset.ticker && asset.current_price && holdings[asset.ticker]) {
        totalMarketValue += asset.current_price * holdings[asset.ticker];
      }
    }

    snapshotValues.push({
      date,
      total_value: totalMarketValue,
      net_invested: netInvested,
    });
  }

  if (snapshotValues.length > 0) {
    // Perform individual inserts to avoid bulk limitations and sqlite limitations
    for (const snap of snapshotValues) {
        await db.insert(snapshots).values(snap).onConflictDoUpdate({
            target: snapshots.date,
            set: {
              net_invested: sql`excluded.net_invested`,
              total_value: sql`excluded.total_value`
            }
        });
    }
  }
}
