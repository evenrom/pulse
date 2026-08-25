import { db } from "../src/db";
import { snapshots, transactions } from "../src/db/schema";
import { calculateFifo } from "../src/lib/fifo";
import { calculateNetInvested } from "../src/lib/finance";

async function main() {
  const allTransactions = await db.select().from(transactions);
  const result = calculateFifo(allTransactions);
  const storedSales = new Map(
    allTransactions
      .filter((tx) => tx.action === "SELL")
      .map((tx) => [tx.id, Number(tx.realized_pl || 0)]),
  );

  console.log("FIFO reconciliation (read-only)");
  console.log(`Transactions: ${allTransactions.length}`);
  console.log(`Sales: ${result.sales.length}`);
  console.log(`Issues: ${result.issues.length}`);

  if (result.sales.length > 0) {
    console.table(result.sales.map((sale) => ({
      date: sale.date,
      ticker: sale.ticker,
      quantity: sale.quantity,
      proceeds: sale.proceeds.toFixed(2),
      fifoCost: sale.costBasis.toFixed(2),
      storedProfit: (storedSales.get(sale.transactionId) || 0).toFixed(2),
      fifoProfit: sale.realizedProfit.toFixed(2),
      difference: (sale.realizedProfit - (storedSales.get(sale.transactionId) || 0)).toFixed(2),
    })));
  }

  console.log("Reconstructed holdings");
  console.table(Object.entries(result.holdings).map(([ticker, quantity]) => ({ ticker, quantity })));

  const allSnapshots = await db.select().from(snapshots);
  const snapshotDifferences = allSnapshots.map((snapshot) => {
    const transactionsThroughDate = allTransactions.filter(tx =>
      tx.date && snapshot.date && String(tx.date).slice(0, 10) <= snapshot.date,
    );
    const calculatedNetInvested = calculateNetInvested(transactionsThroughDate);
    const storedNetInvested = Number(snapshot.net_invested || 0);
    return {
      date: snapshot.date,
      storedNetInvested,
      calculatedNetInvested,
      difference: calculatedNetInvested - storedNetInvested,
    };
  }).filter(item => Math.abs(item.difference) > 0.000001);

  console.log(`Snapshot net-invested differences: ${snapshotDifferences.length}`);
  if (snapshotDifferences.length > 0) console.table(snapshotDifferences);

  if (result.issues.length > 0) {
    console.log("Items requiring attention");
    console.table(result.issues);
    const affectedTickers = new Set(result.issues.map((issue) => issue.ticker).filter(Boolean));
    console.log("Transactions for affected tickers");
    console.table(allTransactions
      .filter((tx) => tx.ticker && affectedTickers.has(tx.ticker.trim().toUpperCase()))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((tx) => ({
        id: tx.id,
        date: tx.date,
        ticker: tx.ticker,
        action: tx.action,
        quantity: tx.quantity,
        price: tx.price,
        totalAmount: tx.total_amount,
        realizedProfit: tx.realized_pl,
      })));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Reconciliation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
