import { transactions, assets } from "@/db/schema";
import { InferSelectModel } from "drizzle-orm";

export type Transaction = InferSelectModel<typeof transactions>;
export type Asset = InferSelectModel<typeof assets>;

/**
 * Calculate Net Invested based on the Golden Formula:
 * Net Invested = Current Cost - Realized Gains
 * @param txs List of transactions
 * @param useHistoricRate If true, applies tx.historic_rate to calculations
 * @returns Total Net Invested
 */
export function calculateNetInvested(txs: Transaction[], useHistoricRate = false): number {
  let currentCost = 0;
  let realizedGains = 0;

  for (const tx of txs) {
    const rate = useHistoricRate ? (tx.historic_rate || 1) : 1;
    const amount = Math.abs(Number(tx.total_amount || 0)) * rate;

    if (tx.action === "BUY" || tx.action === "DRIP") {
      currentCost += amount;
    } else if (tx.action === "SELL") {
      currentCost -= amount;
    }

    realizedGains += (tx.realized_pl || 0) * rate;
  }

  return currentCost + realizedGains;
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
  let totalDrip = 0;

  for (const tx of txs) {
    if (tx.action === "DRIP") {
      const rate = useHistoricRate ? (tx.historic_rate || 1) : 1;
      totalDrip += Math.abs(Number(tx.total_amount || 0)) * rate;
    }
  }

  // Capital Profit = Total Market Value - Net Invested
  const capitalProfit = marketValue - netInvested;

  // Net Profit = (Unrealized Gains) + (Realized Gains) + (Dividends/DRIP)
  // Which is equivalent to Total Market Value - Net Invested + Realized Gains + Total Drip

  let totalRealizedGains = 0;
  for (const tx of txs) {
    const rate = useHistoricRate ? (tx.historic_rate || 1) : 1;
    totalRealizedGains += (tx.realized_pl || 0) * rate;
  }

  const netProfit = capitalProfit + totalRealizedGains + totalDrip;

  return {
    capitalProfit,
    totalDrip,
    netProfit
  };
}
