import { transactions, assets } from "@/db/schema";
import { InferSelectModel } from "drizzle-orm";

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
  let currentCost = 0;
  let totalRealizedGains = 0;
  let totalDrip = 0;

  for (const tx of txs) {
    const rate = useHistoricRate ? (tx.historic_rate || 1) : 1;
    const amount = Math.abs(Number(tx.total_amount || 0)) * rate;

    if (tx.action === "BUY" || tx.action === "DRIP") {
      currentCost += amount;
    } else if (tx.action === "SELL") {
      currentCost -= amount;
    }

    if (tx.action === "DRIP") {
      totalDrip += amount;
    }

    totalRealizedGains += (tx.realized_pl || 0) * rate;
  }

  const netInvested = currentCost + totalRealizedGains;
  const capitalProfit = marketValue - netInvested;
  const netProfit = capitalProfit + totalRealizedGains + totalDrip;

  return {
    netInvested,
    capitalProfit,
    totalDrip,
    totalRealizedGains,
    netProfit
  };
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
  // Provided for backward compatibility; better to use calculateAssetMetrics directly
  const metrics = calculateAssetMetrics(txs, marketValue, useHistoricRate);
  // Re-adjust capital profit using passed netInvested parameter to match previous signature
  const capitalProfit = marketValue - netInvested;
  const netProfit = capitalProfit + metrics.totalRealizedGains + metrics.totalDrip;
  return {
    capitalProfit,
    totalDrip: metrics.totalDrip,
    netProfit
  };
}
