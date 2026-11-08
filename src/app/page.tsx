"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Lock, RefreshCw, DollarSign, Activity, AlertCircle, ArrowRight, Calculator, ArrowRightLeft, List, Plus, Trash2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { SectorEngineAllocation } from "../components/sector-engine-allocation";
import { RegionalAllocation } from "../components/regional-allocation";
import type { SectorAllocation } from "../lib/sector-allocation";
import type { PortfolioAnalytics } from "../lib/portfolio-analytics";
import { FundProfitCharts, periodCutoff, type ProfitPeriod } from "../components/fund-profit-charts";
import { RiskContributionChart } from "../components/risk-contribution-chart";
import { CompanyExposure } from "../components/company-exposure";

type Asset = {
  ticker: string;
  name: string;
  quantity: number;
  current_price: number;
  value_usd: number;
  value_ils: number;
  sector?: string;
  asset_class?: string;
  sector_allocation: SectorAllocation;
  capital_profit_usd: number;
  capital_profit_ils: number;
  total_profit_usd: number;
  total_profit_ils: number;
  realized_profit_usd: number;
  realized_profit_ils: number;
  total_profit_pct: number;
  total_profit_pct_usd: number;
  total_profit_pct_ils: number;
  drip_usd: number;
  drip_ils: number;
  target_pct?: number;
};

type Snapshot = {
  date: string;
  total_value: number;
  net_invested: number;
};

type Metrics = {
  totalMarketValue: number;
  netInvested: number;
  capitalProfit: number;
  totalDrip: number;
  totalRealizedGains: number;
  netProfit: number;
};

type PortfolioData = {
  metrics: {
    usd: Metrics;
    ils: Metrics;
    exchangeRate: number;
  };
  assets: Asset[];
  snapshots: Snapshot[];
  history?: {
    date: string;
    return_pct_usd: number;
    return_pct_ils: number;
    total_value_usd: number;
    total_value_ils: number;
    net_invested_usd: number;
    net_invested_ils: number;
    total_profit_usd: number;
    total_profit_ils: number;
    drip_usd: number;
    drip_ils: number;
    realized_usd: number;
    realized_ils: number;
  }[];
  transactions: {
    id: string;
    date: string | null;
    ticker: string | null;
    action: "BUY" | "SELL" | "DRIP" | null;
    quantity: number | null;
    price: number | null;
    fees: number | null;
    total_amount: number | null;
    historic_rate: number | null;
    realized_pl: number | null;
  }[];
  operationalStatus: {
    lastPriceUpdate: string | null;
    staleTickers: string[];
    activeAssetCount: number;
  };
};

type SyncResult = {
  success: boolean;
  partial: boolean;
  message: string;
  attemptedAt: string;
  updatedTickers: string[];
  failedTickers: { ticker: string; error: string }[];
  sectorRefresh?: {
    updatedTickers: string[];
    failedTickers: { ticker: string; error: string }[];
  };
};

type TradeRow = {
  ticker: string;
  action: "BUY" | "SELL" | "DRIP";
  quantity: string;
  price: string;
  fees: string;
};

const emptyTradeRow = (): TradeRow => ({ ticker: "", action: "BUY", quantity: "", price: "", fees: "0" });

export default function Home() {
  const [pin, setPin] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"usd" | "ils">("usd");
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "holdings" | "simulate" | "history" | "trade">("dashboard");
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const [tradeDate, setTradeDate] = useState(new Date().toISOString().split("T")[0]);
  const [tradeRows, setTradeRows] = useState<TradeRow[]>([emptyTradeRow()]);
  const [isTrading, setIsTrading] = useState(false);
  const [tradeMessage, setTradeMessage] = useState<{type: "success" | "error", text: string} | null>(null);

  const [historyFilter, setHistoryFilter] = useState<ProfitPeriod>("ALL");
  const [analytics, setAnalytics] = useState<PortfolioAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !portfolioData) return;
    const controller = new AbortController();
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    // Reset on a portfolio revision so old weights are never presented beside new holdings.
    setAnalytics(null);
    fetch(`/api/analytics?exchangeRate=${encodeURIComponent(portfolioData.metrics.exchangeRate)}`, { headers: { "x-pin": pin }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Analytics are temporarily unavailable. Try Sync again later.");
        return response.json() as Promise<PortfolioAnalytics>;
      })
      .then(data => { if (!controller.signal.aborted) setAnalytics(data); })
      .catch(() => { if (!controller.signal.aborted) setAnalyticsError("Analytics are temporarily unavailable. Try Sync again later."); })
      .finally(() => { if (!controller.signal.aborted) setAnalyticsLoading(false); });
    return () => controller.abort();
  }, [isAuthenticated, portfolioData, pin]);

  const [newCapital, setNewCapital] = useState<string>("");
  const [targetWeights, setTargetWeights] = useState<Record<string, number>>({});
  const [transactionSearch, setTransactionSearch] = useState("");
  const [transactionAction, setTransactionAction] = useState<"ALL" | "BUY" | "SELL" | "DRIP">("ALL");

  React.useEffect(() => {
    if (portfolioData?.assets) {
      const initialWeights: Record<string, number> = {};
      portfolioData.assets.forEach(asset => {
        initialWeights[asset.ticker] = (asset.target_pct || 0) * 100;
      });
      setTargetWeights(initialWeights);
    }
  }, [portfolioData?.assets]);

  const formatCurrency = (value: number, curr: "usd" | "ils") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr === "usd" ? "USD" : "ILS",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  };

  const filteredHistory = useMemo(() => {
    if (!portfolioData?.history) return [];

    const cutoff = periodCutoff(historyFilter);

    return portfolioData.history
      .filter(item => item.date.slice(0, 10) >= cutoff)
      .map(item => {
        const dateObj = new Date(item.date);
        return {
          ...item,
          return_pct: currency === "usd" ? item.return_pct_usd : item.return_pct_ils,
          formattedDate: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        };
      });
  }, [portfolioData?.history, historyFilter, currency]);

  const maxAbsReturn = useMemo(() => {
    if (!filteredHistory || filteredHistory.length === 0) return 1;
    return Math.max(...filteredHistory.map(d => Math.abs(d.return_pct || 0)), 1);
  }, [filteredHistory]);

  const fetchPortfolio = async (currentPin: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/portfolio", {
        headers: {
          "x-pin": currentPin,
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Incorrect PIN");
        }
        throw new Error("Failed to fetch portfolio data");
      }

      const data = await res.json();
      setPortfolioData(data);
      setIsAuthenticated(true);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim().length === 0) return;
    fetchPortfolio(pin);
  };

  const handleSync = async () => {
    if (!pin) return;
    try {
      setIsSyncing(true);
      setError(null);

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: {
          "x-pin": pin,
        },
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Failed to sync market prices");
      }

      setSyncResult(result);

      // Re-fetch data after sync
      await fetchPortfolio(pin);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to sync");
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTradeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    
    try {
      setIsTrading(true);
      setTradeMessage(null);
      
      const payload = {
        trades: tradeRows.map(row => ({
          ticker: row.ticker.toUpperCase(),
          action: row.action,
          date: tradeDate,
          quantity: parseFloat(row.quantity),
          price: parseFloat(row.price),
          fees: parseFloat(row.fees || "0"),
        })),
      };
      
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pin": pin
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Trade submission failed");
      }
      
      const sales = (data.transactions || []).filter((tx: { action: string }) => tx.action === "SELL");
      const realizedTotal = sales.reduce((sum: number, tx: { realizedProfit: number }) => sum + Number(tx.realizedProfit || 0), 0);
      const realizedText = sales.length > 0 ? ` FIFO profit: ${formatCurrency(realizedTotal, "usd")}.` : "";
      setTradeMessage({ type: "success", text: `${data.count} transaction${data.count === 1 ? "" : "s"} recorded.${realizedText}` });
      setTradeRows([emptyTradeRow()]);
      
      // Refresh portfolio
      await fetchPortfolio(pin);
      
    } catch (err: unknown) {
      if (err instanceof Error) {
        setTradeMessage({ type: "error", text: err.message });
      } else {
        setTradeMessage({ type: "error", text: "An unexpected error occurred" });
      }
    } finally {
      setIsTrading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-6">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-8">
          <div className="flex flex-col items-center justify-center mb-8">
            <div className="h-16 w-16 bg-accent/10 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Access Terminal</h1>
            <p className="text-slate-400 mt-2 text-sm text-center">Enter your secure PIN to view your portfolio.</p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-6">
            <div>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:border-accent transition-all text-center tracking-widest text-lg"
                autoFocus
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 bg-red-400/10 p-3 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || pin.length === 0}
              className="w-full bg-accent hover:bg-accent-bright text-accent-ink font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="h-5 w-5 border-2 border-accent-ink/30 border-t-accent-ink rounded-full animate-spin" />
              ) : (
                <>
                  <span>Unlock</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const currentMetrics = portfolioData?.metrics[currency];

  const totalReturnPct = currentMetrics?.netInvested ? (currentMetrics.netProfit / currentMetrics.netInvested) * 100 : 0;
  const operationalStatus = portfolioData?.operationalStatus;
  const hasSyncProblem = Boolean(syncResult?.failedTickers.length || operationalStatus?.staleTickers.length);
  const lastPriceUpdateLabel = operationalStatus?.lastPriceUpdate
    ? new Date(operationalStatus.lastPriceUpdate).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Never updated";
  const filteredTransactions = (portfolioData?.transactions || []).filter(tx => {
    const matchesAction = transactionAction === "ALL" || tx.action === transactionAction;
    const query = transactionSearch.trim().toUpperCase();
    const matchesSearch = !query || tx.ticker?.toUpperCase().includes(query);
    return matchesAction && matchesSearch;
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="w-8 h-8 text-accent" />
            Pulse
          </h1>
          <p className="text-slate-400 mt-1">Portfolio</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <div
            className={`flex items-center gap-2 text-xs ${hasSyncProblem ? "text-amber-400" : "text-slate-400"}`}
            title={operationalStatus?.staleTickers.length ? `Stale: ${operationalStatus.staleTickers.join(", ")}` : "All active prices are current"}
          >
            <span className={`h-2 w-2 rounded-full ${hasSyncProblem ? "bg-amber-400" : "bg-emerald-400"}`} />
            <span>Prices {lastPriceUpdateLabel}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-1 flex">
            <button
              aria-pressed={currency === "usd"}
              onClick={() => setCurrency("usd")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                currency === "usd" ? "pulse-selection" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              USD
            </button>
            <button
              aria-pressed={currency === "ils"}
              onClick={() => setCurrency("ils")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                currency === "ils" ? "pulse-selection" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              ILS
            </button>
          </div>

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Update market prices and refresh sector weights when due (may take a minute)"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{isSyncing ? "Updating..." : "Refresh"}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-xl text-sm border border-red-500/20">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {syncResult && syncResult.failedTickers.length > 0 && (
        <div className="mb-6 flex items-start gap-2 text-amber-300 bg-amber-400/10 p-4 rounded-xl text-sm border border-amber-500/20">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div>
            <p>{syncResult.message}</p>
            <p className="text-amber-400/80 mt-1">{syncResult.failedTickers.map(item => item.ticker).join(", ")} still use their previous prices.</p>
          </div>
        </div>
      )}

      {activeTab === "dashboard" && currentMetrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
          <div className="pulse-metric col-span-2 bg-slate-900 border border-slate-700 rounded-xl md:rounded-2xl p-4 md:p-5 min-w-0">
            <p className="text-xs md:text-sm text-slate-400 mb-2">Total Profit</p>
            <p className={`text-3xl md:text-4xl font-bold tracking-tight ${currentMetrics.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {currentMetrics.netProfit > 0 ? "+" : ""}{formatCurrency(currentMetrics.netProfit, currency)}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs md:text-sm">
              <span className={currentMetrics.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>{totalReturnPct >= 0 ? "+" : ""}{totalReturnPct.toFixed(1)}%</span>
              <span className="text-slate-500">Dividends: {formatCurrency(currentMetrics.totalDrip, currency)}</span>
            </div>
          </div>
          {[
            { label: "Value", value: currentMetrics.totalMarketValue },
            { label: "Invested", value: currentMetrics.netInvested },
          ].map(card => (
            <div key={card.label} className="bg-slate-900 border border-slate-800 rounded-xl md:rounded-2xl p-4 md:p-5 min-w-0">
              <p className="text-xs md:text-sm text-slate-400 mb-2">{card.label}</p>
              <p className="text-lg md:text-2xl font-bold tracking-tight truncate text-white" title={formatCurrency(card.value, currency)}>{formatCurrency(card.value, currency)}</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === "dashboard" && portfolioData && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
            <div>
              <h3 className="text-white font-semibold text-lg">Portfolio Profit</h3>
              <p className="text-slate-400 text-sm">Zero = Net Invested</p>
            </div>
            <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800">
              {(["1M", "1Q", "1Y", "ALL"] as const).map(filter => (
                <button
                  key={filter}
                  aria-pressed={historyFilter === filter}
                  onClick={() => setHistoryFilter(filter)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    historyFilter === filter
                      ? "pulse-selection"
                      : "text-slate-400 hover:text-slate-300"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
          {filteredHistory.length > 0 ? <div className="pulse-chart h-64 min-w-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredHistory} margin={{ top: 14, right: 12, bottom: 14, left: 12 }}>
                <defs>
                  <linearGradient id="portfolio-profit-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#67e8e7" stopOpacity={0.27} />
                    <stop offset="100%" stopColor="#67e8e7" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis hide dataKey="formattedDate" />
                <YAxis
                  hide
                  domain={[-maxAbsReturn, maxAbsReturn]}
                />
                <ReferenceLine y={0} stroke="var(--chart-zero)" strokeWidth={1.5} />
                <Tooltip
                  content={({ active, payload, label }: { active?: boolean, payload?: readonly unknown[], label?: string | number }) => {
                    if (active && payload && payload.length) {
                      const p = payload[0] as { value: number; payload: Record<string, number> };
                      const val = p.value;
                      return (
                        <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg shadow-xl min-w-44">
                          <p className="text-slate-400 text-sm mb-1">{label}</p>
                          <p className={`font-semibold ${val >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {val > 0 ? "+" : ""}{val.toFixed(2)}%
                          </p>
                          <p className="text-sm text-slate-300 mt-1">{formatCurrency(p.payload[`total_profit_${currency}`], currency)}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="return_pct"
                  stroke="#67e8e7"
                  strokeWidth={2}
                  fill="url(#portfolio-profit-fill)"
                  baseValue={0}
                  activeDot={{ r: 6, fill: "#67e8e7", stroke: "var(--chart-well)", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div> : <p className="flex h-64 items-center justify-center text-sm text-slate-400">No portfolio observations in this period. Choose a longer period.</p>}
        </div>
      )}

      {activeTab === "dashboard" && portfolioData && <>
        <FundProfitCharts data={analytics} currency={currency} period={historyFilter} loading={analyticsLoading} error={analyticsError} />
        <RiskContributionChart data={analytics?.risk || null} returns={portfolioData.assets.filter(asset => asset.quantity > 0).map(asset => ({ ticker: asset.ticker, profitPct: asset.total_profit_pct_usd }))} totalProfitPct={portfolioData.metrics.usd.netInvested > 0 ? portfolioData.metrics.usd.netProfit / portfolioData.metrics.usd.netInvested * 100 : null} loading={analyticsLoading} error={analyticsError} />
      </>}

      {activeTab === "dashboard" && portfolioData?.assets && portfolioData.assets.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectorEngineAllocation
            assets={portfolioData.assets.map(asset => asset.ticker === "FLAX" && analytics?.flaxSectorAllocation
              ? { ...asset, sector_allocation: analytics.flaxSectorAllocation }
              : asset)}
            companies={analytics?.sectorCompanies}
            loading={analyticsLoading}
            failedTickers={syncResult?.sectorRefresh?.failedTickers.map(item => item.ticker)}
          />
          <RegionalAllocation data={analytics?.regional || null} loading={analyticsLoading} error={analyticsError} />
        </div>
      )}

      {activeTab === "holdings" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-slate-800">
            <h2 className="text-xl font-bold text-white">Holdings</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-950/50 text-slate-400">
                <tr>
                  <th className="px-6 py-4 font-medium">Ticker</th>
                  <th className="px-6 py-4 font-medium text-right">Return</th>
                  <th className="px-6 py-4 font-medium text-right">Quantity</th>
                  <th className="px-6 py-4 font-medium text-right">Price</th>
                  <th className="px-6 py-4 font-medium text-right">Value</th>
                  <th className="px-6 py-4 font-medium text-right">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {portfolioData?.assets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                      No holdings.
                    </td>
                  </tr>
                ) : (
                  portfolioData?.assets.filter(a => a.quantity > 0).map((asset) => {
                    const actualWeight = portfolioData.metrics.usd.totalMarketValue > 0
                      ? (asset.value_usd / portfolioData.metrics.usd.totalMarketValue) * 100
                      : 0;
                    const returnPct = currency === "usd" ? asset.total_profit_pct_usd : asset.total_profit_pct_ils;
                    return (
                    <React.Fragment key={asset.ticker}>
                      <tr
                        className="hover:bg-slate-800/50 transition-colors cursor-pointer"
                        onClick={() => setExpandedRow(expandedRow === asset.ticker ? null : asset.ticker)}
                      >
                        <td className="px-6 py-4">
                          <div className="font-semibold text-white flex items-center gap-2">
                            {asset.ticker}
                          </div>
                          <div className="hidden sm:block text-slate-500 text-xs mt-0.5">{asset.name || "Unknown Asset"}</div>
                        </td>
                        <td className={`px-6 py-4 text-right font-medium ${returnPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%
                        </td>
                        <td className="px-6 py-4 text-right text-slate-300">{asset.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td className="px-6 py-4 text-right text-slate-300">
                          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(asset.current_price || 0)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-white">
                          {formatCurrency(currency === "usd" ? asset.value_usd : asset.value_ils, currency)}
                        </td>
                        <td className="px-6 py-4 text-right text-slate-300">{actualWeight.toFixed(1)}%</td>
                      </tr>
                      {expandedRow === asset.ticker && (() => {
                        const totalProfitUsd = asset.total_profit_usd;
                        const dripUsd = asset.drip_usd;
                        const realizedUsd = asset.realized_profit_usd;

                        return (
                          <tr className="bg-slate-900/50">
                            <td colSpan={6} className="px-6 py-4">
                              <div className="grid grid-cols-3 gap-4 text-sm bg-slate-950 p-4 rounded-xl border border-slate-800">
                                <div>
                                  <p className="text-slate-500 mb-1">Total profit</p>
                                  <p className={`font-medium ${totalProfitUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                    {totalProfitUsd >= 0 ? "+" : ""}{formatCurrency(totalProfitUsd, "usd")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-slate-500 mb-1">DRIP profit</p>
                                  <p className="font-medium text-white">{formatCurrency(dripUsd, "usd")}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 mb-1">Realized profit</p>
                                  <p className={`font-medium ${realizedUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatCurrency(realizedUsd, "usd")}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })()}
                    </React.Fragment>
                  );})
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "holdings" && <CompanyExposure data={analytics?.exposure || null} loading={analyticsLoading} error={analyticsError} />}

      {activeTab === "history" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">History</h2>
              <p className="text-sm text-slate-400 mt-1">{portfolioData?.transactions.length || 0} transactions</p>
            </div>
            <div className="flex gap-2">
              <input
                type="search"
                value={transactionSearch}
                onChange={(event) => setTransactionSearch(event.target.value)}
                placeholder="Ticker"
                className="w-28 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-accent"
              />
              <select
                value={transactionAction}
                onChange={(event) => setTransactionAction(event.target.value as "ALL" | "BUY" | "SELL" | "DRIP")}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:border-accent"
              >
                <option value="ALL">All</option>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
                <option value="DRIP">DRIP</option>
              </select>
            </div>
          </div>
          <div className="md:hidden divide-y divide-slate-800">
            {filteredTransactions.length === 0 ? (
              <p className="p-8 text-center text-slate-500">No matches.</p>
            ) : filteredTransactions.map(tx => (
              <div key={tx.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{tx.ticker}</span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${tx.action === "BUY" ? "bg-accent/10 text-accent" : tx.action === "SELL" ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>{tx.action}</span>
                  </div>
                  <span className="text-xs text-slate-500">{tx.date ? new Date(tx.date).toLocaleDateString() : "—"}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-slate-500">Qty</p><p className="text-slate-300 font-mono">{Number(tx.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}</p></div>
                  <div><p className="text-slate-500">Price</p><p className="text-slate-300 font-mono">{formatCurrency(Number(tx.price || 0), "usd")}</p></div>
                  <div className="text-right"><p className="text-slate-500">Total</p><p className="text-white font-mono">{formatCurrency(Number(tx.total_amount || 0), "usd")}</p></div>
                </div>
                {tx.action === "SELL" && <p className={`text-xs mt-2 ${Number(tx.realized_pl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>FIFO profit: {formatCurrency(Number(tx.realized_pl || 0), "usd")}</p>}
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-950/50 text-slate-400">
                <tr>
                  <th className="px-5 py-4 font-medium">Date</th>
                  <th className="px-5 py-4 font-medium">Ticker</th>
                  <th className="px-5 py-4 font-medium">Action</th>
                  <th className="px-5 py-4 font-medium text-right">Quantity</th>
                  <th className="px-5 py-4 font-medium text-right">Price</th>
                  <th className="px-5 py-4 font-medium text-right">Total</th>
                  <th className="px-5 py-4 font-medium text-right">FIFO Profit</th>
                  <th className="px-5 py-4 font-medium text-right">USD/ILS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredTransactions.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">No matching transactions.</td></tr>
                ) : filteredTransactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-slate-800/40">
                    <td className="px-5 py-4 text-slate-400">{tx.date ? new Date(tx.date).toLocaleDateString() : "—"}</td>
                    <td className="px-5 py-4 font-semibold text-white">{tx.ticker || "—"}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2 py-1 rounded-md text-xs font-semibold ${
                        tx.action === "BUY" ? "bg-accent/10 text-accent" :
                        tx.action === "SELL" ? "bg-amber-500/10 text-amber-400" :
                        "bg-emerald-500/10 text-emerald-400"
                      }`}>{tx.action}</span>
                    </td>
                    <td className="px-5 py-4 text-right text-slate-300 font-mono">{Number(tx.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                    <td className="px-5 py-4 text-right text-slate-300 font-mono">{formatCurrency(Number(tx.price || 0), "usd")}</td>
                    <td className="px-5 py-4 text-right text-white font-mono">{formatCurrency(Number(tx.total_amount || 0), "usd")}</td>
                    <td className={`px-5 py-4 text-right font-mono ${Number(tx.realized_pl || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {tx.action === "SELL" ? formatCurrency(Number(tx.realized_pl || 0), "usd") : "—"}
                    </td>
                    <td className="px-5 py-4 text-right text-slate-400 font-mono">{Number(tx.historic_rate || 0).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "simulate" && (() => {
        const newCapitalNum = Number(newCapital) || 0;
        const exchangeRate = portfolioData?.metrics.exchangeRate || 1;
        const newCapitalUsd = currency === "usd" ? newCapitalNum : newCapitalNum / exchangeRate;
        const currentTotalMarketValueUsd = portfolioData?.metrics.usd.totalMarketValue || 0;
        const projectedTotalUsd = currentTotalMarketValueUsd + newCapitalUsd;

        const assetsToRender = portfolioData?.assets.filter(a => a.quantity > 0 || (a.target_pct || 0) > 0) || [];

        let totalPositiveDeficitsUsd = 0;
        assetsToRender.forEach(asset => {
          const targetValueUsd = projectedTotalUsd * ((targetWeights[asset.ticker] || 0) / 100);
          const deficitUsd = targetValueUsd - asset.value_usd;
          if (deficitUsd > 0) {
            totalPositiveDeficitsUsd += deficitUsd;
          }
        });

        const showWarningBanner = totalPositiveDeficitsUsd > newCapitalUsd && newCapitalUsd > 0;
        const isInsufficientCapital = totalPositiveDeficitsUsd > newCapitalUsd;
        const missingCapitalUsd = totalPositiveDeficitsUsd - newCapitalUsd;
        const missingCapitalDisplay = currency === "usd" ? missingCapitalUsd : missingCapitalUsd * exchangeRate;

        return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Calculator className="w-5 h-5 text-accent" />
              Rebalance
            </h2>
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-400 mb-2">New contribution ({currency.toUpperCase()})</label>
            <input
              type="number"
              value={newCapital}
              onChange={(e) => setNewCapital(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:border-accent transition-colors"
              placeholder="e.g. 10000"
            />
          </div>

          {showWarningBanner && (
            <div className="mb-6 bg-red-950/30 border border-red-900/50 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">
                Add <strong className="font-semibold">{formatCurrency(missingCapitalDisplay, currency)}</strong> more for full balance without selling.
              </p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-950/50 text-slate-400 border-y border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium text-right">Current Value</th>
                  <th className="px-4 py-3 font-medium text-right">Current Weight</th>
                  <th className="px-4 py-3 font-medium text-right w-32">Target (%)</th>
                  <th className="px-4 py-3 font-medium text-right">Drift</th>
                  <th className="px-4 py-3 font-medium text-right text-accent">Amount to Buy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {assetsToRender.map((asset) => {
                  const currentValueDisplay = currency === "usd" ? asset.value_usd : asset.value_ils;
                  const currentTotalMarketValueDisplay = currentMetrics?.totalMarketValue || 0;
                  const currentWeight = currentTotalMarketValueDisplay > 0 ? (currentValueDisplay / currentTotalMarketValueDisplay) * 100 : 0;
                  const targetWeight = targetWeights[asset.ticker] || 0;
                  const drift = currentWeight - targetWeight;
                  const driftTone = Math.abs(drift) <= 1 ? "text-slate-400" : Math.abs(drift) <= 3 ? "text-amber-400" : "text-red-400";

                  const targetValueUsd = projectedTotalUsd * ((targetWeights[asset.ticker] || 0) / 100);
                  const idealDeficitUsd = targetValueUsd - asset.value_usd;

                  let amountToBuyUsd = 0;
                  if (idealDeficitUsd > 0) {
                    if (isInsufficientCapital) {
                      amountToBuyUsd = newCapitalUsd * (idealDeficitUsd / totalPositiveDeficitsUsd);
                    } else {
                      amountToBuyUsd = idealDeficitUsd;
                    }
                  }
                  const amountToBuyDisplay = currency === "usd" ? amountToBuyUsd : amountToBuyUsd * exchangeRate;

                  return (
                    <tr key={asset.ticker} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{asset.ticker}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(currentValueDisplay, currency)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{currentWeight.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          value={targetWeights[asset.ticker] !== undefined ? targetWeights[asset.ticker] : ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTargetWeights(prev => ({
                              ...prev,
                              [asset.ticker]: val === "" ? 0 : Number(val)
                            }));
                          }}
                          className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white text-right focus:border-accent"
                        />
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${driftTone}`}>{drift >= 0 ? "+" : ""}{drift.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-400">
                        {amountToBuyDisplay > 0 ? `+${formatCurrency(amountToBuyDisplay, currency)}` : "$0"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-950/50 text-slate-400 border-t border-slate-800">
                <tr>
                  <td colSpan={3} className="px-4 py-3 font-medium text-right text-slate-300">Total</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${Object.values(targetWeights).reduce((a, b) => a + (b || 0), 0) !== 100 ? "text-red-500" : "text-slate-300"}`}>
                      {Object.values(targetWeights).reduce((a, b) => a + (b || 0), 0).toFixed(1)}%
                    </span>
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right font-medium text-emerald-400">
                    +{formatCurrency(assetsToRender.reduce((sum, asset) => {
                        const targetValueUsd = projectedTotalUsd * ((targetWeights[asset.ticker] || 0) / 100);
                        const idealDeficitUsd = targetValueUsd - asset.value_usd;
                        let amountToBuyUsd = 0;
                        if (idealDeficitUsd > 0) {
                          if (isInsufficientCapital) {
                            amountToBuyUsd = newCapitalUsd * (idealDeficitUsd / totalPositiveDeficitsUsd);
                          } else {
                            amountToBuyUsd = idealDeficitUsd;
                          }
                        }
                        return sum + (currency === "usd" ? amountToBuyUsd : amountToBuyUsd * exchangeRate);
                    }, 0), currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        );
      })()}

      {activeTab === "trade" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-8 max-w-5xl mx-auto mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Add Transactions</h2>
              <p className="text-slate-400 mt-1 text-sm">Record one purchase or the full month</p>
            </div>
            <div className="hidden sm:block p-3 bg-accent/10 rounded-xl border border-accent/20">
               <ArrowRightLeft className="w-6 h-6 text-accent" />
            </div>
          </div>
          
          {tradeMessage && (
            <div className={`mb-6 p-4 rounded-xl border flex items-start gap-3 backdrop-blur-md transition-all ${tradeMessage.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{tradeMessage.text}</p>
            </div>
          )}

          <form onSubmit={handleTradeSubmit} className="space-y-5">
            <div className="max-w-xs">
              <label className="block text-xs font-medium text-slate-400 mb-2">Date for this batch</label>
              <input
                type="date"
                required
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className="w-full bg-slate-950/50 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:border-accent"
              />
            </div>

            <div className="space-y-3">
              {tradeRows.map((row, index) => {
                const updateRow = (field: keyof TradeRow, value: string) => setTradeRows(current => current.map((item, rowIndex) => rowIndex === index ? { ...item, [field]: value } : item));
                return (
                  <div key={index} className="grid grid-cols-2 md:grid-cols-[1.1fr_1fr_1fr_1fr_0.8fr_auto] gap-2 p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                    <label className="col-span-1">
                      <span className="text-[11px] text-slate-500 md:hidden">Ticker</span>
                      <select required value={row.ticker} onChange={event => updateRow("ticker", event.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white">
                        <option value="">Ticker</option>
                        {portfolioData?.assets.map(asset => <option key={asset.ticker} value={asset.ticker}>{asset.ticker}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="text-[11px] text-slate-500 md:hidden">Action</span>
                      <select value={row.action} onChange={event => updateRow("action", event.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white">
                        <option value="BUY">BUY</option><option value="SELL">SELL</option><option value="DRIP">DRIP</option>
                      </select>
                    </label>
                    <label>
                      <span className="text-[11px] text-slate-500">Qty</span>
                      <input required type="number" step="any" min="0" value={row.quantity} onChange={event => updateRow("quantity", event.target.value)} placeholder="0" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono" />
                    </label>
                    <label>
                      <span className="text-[11px] text-slate-500">Price</span>
                      <input required type="number" step="any" min="0" value={row.price} onChange={event => updateRow("price", event.target.value)} placeholder="$" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono" />
                    </label>
                    <label>
                      <span className="text-[11px] text-slate-500">Fee</span>
                      <input required type="number" step="any" min="0" value={row.fees} onChange={event => updateRow("fees", event.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono" />
                    </label>
                    <button type="button" disabled={tradeRows.length === 1} onClick={() => setTradeRows(current => current.filter((_, rowIndex) => rowIndex !== index))} className="self-end p-2 text-slate-500 hover:text-red-400 disabled:opacity-20" aria-label={`Remove row ${index + 1}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button type="button" disabled={tradeRows.length >= 20} onClick={() => setTradeRows(current => [...current, emptyTradeRow()])} className="flex items-center gap-2 text-sm text-accent hover:text-white disabled:opacity-40">
              <Plus className="w-4 h-4" /> Add row
            </button>

            <button
              type="submit"
              disabled={isTrading}
              className="w-full bg-accent hover:bg-accent-bright text-accent-ink font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed mt-2 font-sans"
            >
              {isTrading ? (
                <div className="h-5 w-5 border-2 border-accent-ink/30 border-t-accent-ink rounded-full animate-spin" />
              ) : (
                <>
                  <span>Record {tradeRows.length}</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 w-full h-16 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 flex items-center justify-around z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.24)] pb-[env(safe-area-inset-bottom)]">
        {[
          { id: "dashboard", label: "Home", icon: Activity },
          { id: "holdings", label: "Assets", icon: DollarSign },
          { id: "simulate", label: "Plan", icon: Calculator },
          { id: "history", label: "History", icon: List },
          { id: "trade", label: "Trade", icon: ArrowRightLeft },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              aria-current={isActive ? "page" : undefined}
              onClick={() => setActiveTab(tab.id as "dashboard" | "holdings" | "simulate" | "history" | "trade")}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] sm:text-sm font-medium transition-colors cursor-pointer relative w-full h-full ${isActive ? "text-accent" : "text-slate-400 hover:text-slate-200"}`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-lg ${isActive ? "pulse-selection" : ""}`}><Icon className="h-5 w-5" /></span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
