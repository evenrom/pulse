import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const assets = sqliteTable("assets", {
  ticker: text("ticker").primaryKey(),
  name: text("name"),
  region: text("region"),
  sector: text("sector"),
  asset_class: text("asset_class"),
  current_price: real("current_price"),
  target_pct: real("target_pct"),
  div_yield: real("div_yield"),
  updated_at: integer("updated_at", { mode: "timestamp" }),
});

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  date: text("date"),
  ticker: text("ticker"),
  action: text("action", { enum: ["BUY", "SELL", "DRIP"] }),
  quantity: real("quantity"),
  price: real("price"),
  fees: real("fees"),
  total_amount: real("total_amount"),
  historic_rate: real("historic_rate"),
  realized_pl: real("realized_pl"),
  created_at: integer("created_at", { mode: "timestamp" }),
});

export const snapshots = sqliteTable("snapshots", {
  date: text("date").primaryKey(),
  total_value: real("total_value"),
  net_invested: real("net_invested"),
});
