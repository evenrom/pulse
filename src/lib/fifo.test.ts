import assert from "node:assert/strict";
import test from "node:test";
import { calculateFifo, FifoTransaction } from "./fifo";

function tx(overrides: Partial<FifoTransaction> & Pick<FifoTransaction, "id" | "action" | "quantity" | "total_amount">): FifoTransaction {
  return {
    date: "2026-01-01",
    ticker: "VOO",
    price: 0,
    fees: 0,
    ...overrides,
  };
}

test("a DRIP lot adds shares and remains eligible for FIFO", () => {
  const result = calculateFifo([
    tx({ id: "buy", action: "BUY", quantity: 1, total_amount: 100 }),
    tx({ id: "drip", action: "DRIP", quantity: 0.125, total_amount: 12.5, date: "2026-02-01" }),
  ]);

  assert.equal(result.holdings.VOO, 1.125);
  assert.equal(result.openLots.VOO[1].source, "DRIP");
  assert.equal(result.issues.length, 0);
});

test("a fractional sale consumes the oldest lots first", () => {
  const result = calculateFifo([
    tx({ id: "first", action: "BUY", quantity: 0.8, total_amount: 80 }),
    tx({ id: "second", action: "BUY", quantity: 1, total_amount: 120, date: "2026-02-01" }),
    tx({ id: "sale", action: "SELL", quantity: 1.35, total_amount: 202.5, date: "2026-03-01" }),
  ]);

  assert.equal(result.sales[0].consumedLots[0].quantity, 0.8);
  assert.equal(result.sales[0].consumedLots[1].quantity, 0.55);
  assert.equal(result.sales[0].costBasis, 146);
  assert.equal(result.sales[0].realizedProfit, 56.5);
  assert.equal(result.holdings.VOO, 0.45);
  assert.equal(result.issues.length, 0);
});

test("purchase fees are included in FIFO cost basis", () => {
  const result = calculateFifo([
    tx({ id: "buy", action: "BUY", quantity: 2, total_amount: 202, fees: 2 }),
    tx({ id: "sale", action: "SELL", quantity: 1, total_amount: 119, fees: 1, date: "2026-02-01" }),
  ]);

  assert.equal(result.sales[0].costBasis, 101);
  assert.equal(result.sales[0].realizedProfit, 18);
});

test("a sale larger than the holding is reported and not applied", () => {
  const result = calculateFifo([
    tx({ id: "buy", action: "BUY", quantity: 0.25, total_amount: 25 }),
    tx({ id: "sale", action: "SELL", quantity: 0.3, total_amount: 36, date: "2026-02-01" }),
  ]);

  assert.equal(result.sales.length, 0);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /exceeds available FIFO holdings/);
});
