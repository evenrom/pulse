export type FifoAction = "BUY" | "SELL" | "DRIP";

export type FifoTransaction = {
  id: string;
  date: string | null;
  ticker: string | null;
  action: FifoAction | null;
  quantity: number | null;
  price: number | null;
  fees: number | null;
  total_amount: number | null;
  created_at?: string | number | null;
};

export type FifoLot = {
  transactionId: string;
  date: string;
  originalQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  source: "BUY" | "DRIP";
};

export type FifoLotConsumption = {
  lotTransactionId: string;
  lotDate: string;
  quantity: number;
  unitCost: number;
  costBasis: number;
  source: "BUY" | "DRIP";
};

export type FifoSale = {
  transactionId: string;
  date: string;
  ticker: string;
  quantity: number;
  proceeds: number;
  costBasis: number;
  realizedProfit: number;
  consumedLots: FifoLotConsumption[];
};

export type FifoIssue = {
  transactionId: string;
  ticker: string | null;
  message: string;
};

export type FifoResult = {
  sales: FifoSale[];
  openLots: Record<string, FifoLot[]>;
  holdings: Record<string, number>;
  issues: FifoIssue[];
};

const QUANTITY_PRECISION = 12;
const MONEY_PRECISION = 8;
const EPSILON = 1e-10;

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function transactionTimestamp(tx: FifoTransaction): number {
  const timestamp = Date.parse(tx.date || "");
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

/**
 * Stable FIFO ordering: execution date, insertion timestamp, then transaction ID.
 * The final ID tie-breaker makes reconciliation deterministic for legacy records.
 */
export function sortFifoTransactions(txs: FifoTransaction[]): FifoTransaction[] {
  return txs
    .map((tx, index) => ({ tx, index }))
    .sort((a, b) => {
      const dateDifference = transactionTimestamp(a.tx) - transactionTimestamp(b.tx);
      if (dateDifference !== 0) return dateDifference;

      const createdA = Number(a.tx.created_at);
      const createdB = Number(b.tx.created_at);
      if (Number.isFinite(createdA) && Number.isFinite(createdB) && createdA !== createdB) {
        return createdA - createdB;
      }

      const idDifference = a.tx.id.localeCompare(b.tx.id);
      return idDifference !== 0 ? idDifference : a.index - b.index;
    })
    .map(({ tx }) => tx);
}

/**
 * Reconstructs holdings and realized profit using FIFO. BUY and DRIP both create
 * lots; DRIP lots do not affect Net Invested elsewhere in the application.
 */
export function calculateFifo(txs: FifoTransaction[]): FifoResult {
  const openLots: Record<string, FifoLot[]> = {};
  const holdings: Record<string, number> = {};
  const sales: FifoSale[] = [];
  const issues: FifoIssue[] = [];

  for (const tx of sortFifoTransactions(txs)) {
    const ticker = tx.ticker?.trim().toUpperCase() || null;
    const quantity = Number(tx.quantity);
    const totalAmount = Number(tx.total_amount);

    if (!ticker || !tx.action || !Number.isFinite(quantity) || quantity <= 0) {
      issues.push({
        transactionId: tx.id,
        ticker,
        message: "Transaction requires a ticker, action, and positive full-precision quantity.",
      });
      continue;
    }

    if (!Number.isFinite(totalAmount) || totalAmount < 0) {
      issues.push({
        transactionId: tx.id,
        ticker,
        message: "Transaction requires a non-negative total amount.",
      });
      continue;
    }

    openLots[ticker] ||= [];
    holdings[ticker] ||= 0;

    if (tx.action === "BUY" || tx.action === "DRIP") {
      const unitCost = totalAmount / quantity;
      openLots[ticker].push({
        transactionId: tx.id,
        date: tx.date || "",
        originalQuantity: quantity,
        remainingQuantity: quantity,
        unitCost,
        source: tx.action,
      });
      holdings[ticker] = round(holdings[ticker] + quantity, QUANTITY_PRECISION);
      continue;
    }

    let remainingToSell = quantity;
    let costBasis = 0;
    const consumedLots: FifoLotConsumption[] = [];

    const availableQuantity = openLots[ticker].reduce(
      (sum, lot) => sum + lot.remainingQuantity,
      0,
    );
    if (availableQuantity + EPSILON < quantity) {
      issues.push({
        transactionId: tx.id,
        ticker,
        message: `Sale exceeds available FIFO holdings by ${round(quantity - availableQuantity, QUANTITY_PRECISION)} shares.`,
      });
      continue;
    }

    for (const lot of openLots[ticker]) {
      if (remainingToSell <= EPSILON) break;
      if (lot.remainingQuantity <= EPSILON) continue;

      const consumedQuantity = Math.min(lot.remainingQuantity, remainingToSell);
      const consumedCost = consumedQuantity * lot.unitCost;

      lot.remainingQuantity = round(lot.remainingQuantity - consumedQuantity, QUANTITY_PRECISION);
      remainingToSell = round(remainingToSell - consumedQuantity, QUANTITY_PRECISION);
      costBasis += consumedCost;
      consumedLots.push({
        lotTransactionId: lot.transactionId,
        lotDate: lot.date,
        quantity: consumedQuantity,
        unitCost: lot.unitCost,
        costBasis: round(consumedCost, MONEY_PRECISION),
        source: lot.source,
      });
    }

    holdings[ticker] = round(holdings[ticker] - quantity, QUANTITY_PRECISION);
    sales.push({
      transactionId: tx.id,
      date: tx.date || "",
      ticker,
      quantity,
      proceeds: totalAmount,
      costBasis: round(costBasis, MONEY_PRECISION),
      realizedProfit: round(totalAmount - costBasis, MONEY_PRECISION),
      consumedLots,
    });
  }

  for (const ticker of Object.keys(openLots)) {
    openLots[ticker] = openLots[ticker].filter((lot) => lot.remainingQuantity > EPSILON);
  }

  return { sales, openLots, holdings, issues };
}
