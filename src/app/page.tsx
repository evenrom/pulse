"use client";

import React, { useState, useMemo } from "react";
import { Lock, RefreshCw, DollarSign, Activity, TrendingUp, AlertCircle, ArrowRight, Calculator } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { PALETTE, ENGINE_MAP, SECTOR_TO_ENGINE, GEO_BREAKDOWN, SECTOR_BREAKDOWN } from "../lib/config";

type Asset = {
  ticker: string;
  name: string;
  quantity: number;
  current_price: number;
  value_usd: number;
  value_ils: number;
  sector?: string;
  asset_class?: string;
  capital_profit_usd: number;
  capital_profit_ils: number;
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
};

export default function Home() {
  const [pin, setPin] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"usd" | "ils">("usd");
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "holdings" | "simulate">("dashboard");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const [newCapital, setNewCapital] = useState<string>("");
  const [targetWeights, setTargetWeights] = useState<Record<string, number>>({});

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
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const { engineData, sectorData, regionalData, flatSectorData } = useMemo(() => {
    if (!portfolioData?.assets) return { engineData: [], sectorData: [], regionalData: [], flatSectorData: [] };

    const sectorValues: Record<string, number> = {};
    const regionValues: Record<string, number> = {};

    portfolioData.assets.forEach(asset => {
      const val = currency === "usd" ? asset.value_usd : asset.value_ils;
      if (val <= 0) return;

      const sectors = SECTOR_BREAKDOWN[asset.ticker] || { 'Other': 1.0 };
      Object.entries(sectors).forEach(([sec, weight]) => {
        sectorValues[sec] = (sectorValues[sec] || 0) + val * weight;
      });

      const regions = GEO_BREAKDOWN[asset.ticker] || { 'Unknown': 1.0 };
      Object.entries(regions).forEach(([reg, weight]) => {
        regionValues[reg] = (regionValues[reg] || 0) + val * weight;
      });
    });

    const engineValues: Record<string, number> = {};
    const engineToSectors: Record<string, Record<string, number>> = {};

    Object.keys(ENGINE_MAP).forEach(engine => {
      engineValues[engine] = 0;
      engineToSectors[engine] = {};
    });

    Object.entries(sectorValues).forEach(([sec, val]) => {
      const foundEngine = SECTOR_TO_ENGINE[sec] || 'Other';

      if (!engineValues[foundEngine]) engineValues[foundEngine] = 0;
      engineValues[foundEngine] += val;

      if (!engineToSectors[foundEngine]) engineToSectors[foundEngine] = {};
      engineToSectors[foundEngine][sec] = val;
    });

    const totalSectorVal = Object.values(sectorValues).reduce((a, b) => a + b, 0) || 1;
    const totalRegionVal = Object.values(regionValues).reduce((a, b) => a + b, 0) || 1;

    const formattedEngineData = Object.entries(engineValues)
      .filter(([, val]) => val > 0)
      .map(([name, value]) => ({ name, value, pct: (value / totalSectorVal) * 100 }))
      .sort((a, b) => b.value - a.value);

    const formattedSectorData: { name: string; value: number; engine: string; engineIndex: number; sectorIndex: number }[] = [];
    formattedEngineData.forEach((engine, eIndex) => {
       const secs = engineToSectors[engine.name] || {};
       Object.entries(secs)
         .filter(([, val]) => val > 0)
         .sort((a, b) => b[1] - a[1])
         .forEach(([name, value], sIndex) => {
           formattedSectorData.push({ name, value, engine: engine.name, engineIndex: eIndex, sectorIndex: sIndex });
         });
    });

    const formattedRegionalData = Object.entries(regionValues)
      .filter(([, val]) => val > 0)
      .map(([name, value]) => ({ name, value, pct: (value / totalRegionVal) * 100 }))
      .sort((a, b) => b.value - a.value);

    const sortedSectorData = Object.entries(sectorValues)
      .filter(([, val]) => val > 0)
      .map(([name, value]) => ({ name, value, pct: (value / totalSectorVal) * 100 }))
      .sort((a, b) => b.value - a.value);

    return { engineData: formattedEngineData, sectorData: formattedSectorData, regionalData: formattedRegionalData, flatSectorData: sortedSectorData };
  }, [portfolioData?.assets, currency]);

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

      if (!res.ok) {
        throw new Error("Failed to sync market prices");
      }

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

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-6">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-8">
          <div className="flex flex-col items-center justify-center mb-8">
            <div className="h-16 w-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-blue-500" />
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
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-center tracking-widest text-lg"
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
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="w-8 h-8 text-blue-500" />
            Pulse
          </h1>
          <p className="text-slate-400 mt-1">Terminal Dashboard</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-1 flex">
            <button
              onClick={() => setCurrency("usd")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                currency === "usd" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              USD
            </button>
            <button
              onClick={() => setCurrency("ils")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                currency === "ils" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              ILS
            </button>
          </div>

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Update market prices (may take a minute)"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{isSyncing ? "Syncing..." : "Refresh Prices"}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-xl text-sm border border-red-500/20">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {activeTab === "dashboard" && currentMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-400 font-medium">Total Market Value</h3>
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <DollarSign className="w-5 h-5 text-blue-500" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-white tracking-tight">
                {formatCurrency(currentMetrics.totalMarketValue, currency)}
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-400 font-medium">Net Invested</h3>
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Activity className="w-5 h-5 text-purple-500" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-white tracking-tight">
                {formatCurrency(currentMetrics.netInvested, currency)}
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-400 font-medium">Capital Profit</h3>
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
            <div>
              <p className={`text-3xl font-bold tracking-tight ${currentMetrics.capitalProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {currentMetrics.capitalProfit >= 0 ? "+" : ""}{formatCurrency(currentMetrics.capitalProfit, currency)}
              </p>
              <div className="text-sm text-slate-400 mt-2 flex items-center justify-between">
                <span>Capital: {formatCurrency(currentMetrics.capitalProfit, currency)}</span>
                <span>•</span>
                <span>DRIP: {formatCurrency(currentMetrics.totalDrip, currency)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "dashboard" && portfolioData?.snapshots && portfolioData.snapshots.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8">
          <h3 className="text-xl font-bold text-white mb-6">Portfolio History</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={portfolioData.snapshots}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  tickFormatter={(val) => new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis
                  stroke="#94a3b8"
                  tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
                  itemStyle={{ color: '#e2e8f0' }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(value: unknown) => {
                    const numValue = Number(value);
                    if (isNaN(numValue)) return [String(value), 'Value'];
                    return [new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numValue), 'Value'];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="total_value"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 8, fill: '#3b82f6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "dashboard" && portfolioData?.assets && portfolioData.assets.length > 0 && (
        <div className="space-y-6 mb-8">
          {/* Chart 1: Growth Drivers */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-6">Growth Drivers</h3>
            <div className="h-80 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {/* Outer Ring: Engines */}
                  <Pie
                    data={engineData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={110}
                    outerRadius={140}
                    stroke="none"
                  >
                    {engineData.map((entry, index) => (
                      <Cell key={`engine-${index}`} fill={PALETTE[index % PALETTE.length]} />
                    ))}
                  </Pie>
                  {/* Inner Ring: Sectors */}
                  <Pie
                    data={sectorData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={100}
                    stroke="none"
                  >
                    {sectorData.map((entry, index) => {
                      const baseColor = PALETTE[entry.engineIndex % PALETTE.length];

                      // Vary opacity: 0.9, 0.7, 0.5, etc.
                      const opacity = Math.max(0.3, 0.9 - (entry.sectorIndex * 0.2));

                      return <Cell key={`sector-${index}`} fill={baseColor} fillOpacity={opacity} />;
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }}
                    itemStyle={{ color: '#e2e8f0' }}
                    formatter={(value: unknown, name: unknown) => {
                      const numValue = Number(value);
                      const safeName = String(name ?? '');
                      if (isNaN(numValue)) return [String(value), safeName];
                      return [formatCurrency(numValue, currency), safeName];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Custom Legend for Engines */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {engineData.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
                  <span className="text-sm text-slate-300">{entry.name}</span>
                  <span className="text-sm font-medium text-white">{entry.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chart 2: Regional Split */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-6">Regional Split</h3>
            <div className="h-3 w-full rounded-full flex overflow-hidden mb-4">
              {regionalData.map((entry, index) => (
                <div
                  key={entry.name}
                  style={{ width: `${entry.pct}%`, backgroundColor: PALETTE[index % PALETTE.length] }}
                  title={`${entry.name}: ${entry.pct.toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {regionalData.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
                  <span className="text-sm text-slate-300">{entry.name}</span>
                  <span className="text-sm font-medium text-white">{entry.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chart 3: Sector Allocation */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-6">Sector Allocation</h3>
            <div className="h-3 w-full rounded-full flex overflow-hidden mb-4">
              {flatSectorData.map((entry, index) => (
                <div
                  key={entry.name}
                  style={{ width: `${entry.pct}%`, backgroundColor: PALETTE[index % PALETTE.length] }}
                  title={`${entry.name}: ${entry.pct.toFixed(1)}%`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {flatSectorData.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
                  <span className="text-sm text-slate-300 truncate" title={entry.name}>{entry.name}</span>
                  <span className="text-sm font-medium text-white">{entry.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
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
                  <th className="px-6 py-4 font-medium text-right">Quantity</th>
                  <th className="px-6 py-4 font-medium text-right">Current Price</th>
                  <th className="px-6 py-4 font-medium text-right">Value ({currency.toUpperCase()})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {portfolioData?.assets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                      No holdings found.
                    </td>
                  </tr>
                ) : (
                  portfolioData?.assets.filter(a => a.quantity > 0).map((asset) => (
                    <React.Fragment key={asset.ticker}>
                      <tr
                        className="hover:bg-slate-800/50 transition-colors cursor-pointer"
                        onClick={() => setExpandedRow(expandedRow === asset.ticker ? null : asset.ticker)}
                      >
                        <td className="px-6 py-4">
                          <div className="font-semibold text-white flex items-center gap-2">
                            {asset.ticker}
                          </div>
                          <div className="text-slate-500 text-xs mt-0.5">{asset.name || "Unknown Asset"}</div>
                        </td>
                        <td className="px-6 py-4 text-right text-slate-300">{asset.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td className="px-6 py-4 text-right text-slate-300">
                          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(asset.current_price || 0)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-white">
                          {formatCurrency(currency === "usd" ? asset.value_usd : asset.value_ils, currency)}
                        </td>
                      </tr>
                      {expandedRow === asset.ticker && (
                        <tr className="bg-slate-900/50">
                          <td colSpan={4} className="px-6 py-4">
                            <div className="grid grid-cols-3 gap-4 text-sm bg-slate-950 p-4 rounded-xl border border-slate-800">
                              <div>
                                <p className="text-slate-500 mb-1">Total Profit (%)</p>
                                <p className={`font-medium ${(currency === "usd" ? asset.total_profit_pct_usd : asset.total_profit_pct_ils) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                  {(currency === "usd" ? asset.total_profit_pct_usd : asset.total_profit_pct_ils) >= 0 ? "+" : ""}{(currency === "usd" ? asset.total_profit_pct_usd : asset.total_profit_pct_ils).toFixed(2)}%
                                </p>
                              </div>
                              <div>
                                <p className="text-slate-500 mb-1">Total Profit ($)</p>
                                <p className={`font-medium ${asset.capital_profit_usd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                  {asset.capital_profit_usd >= 0 ? "+" : ""}{formatCurrency(currency === "usd" ? asset.capital_profit_usd : asset.capital_profit_ils, currency)}
                                </p>
                              </div>
                              <div>
                                <p className="text-slate-500 mb-1">Reinvested (DRIP)</p>
                                <p className="font-medium text-white">
                                  {formatCurrency(currency === "usd" ? asset.drip_usd : asset.drip_ils, currency)}
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "simulate" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Calculator className="w-5 h-5 text-blue-400" />
              Rebalancing Simulator
            </h2>
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-400 mb-2">New Capital to Invest ($)</label>
            <input
              type="number"
              value={newCapital}
              onChange={(e) => setNewCapital(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              placeholder="e.g. 10000"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-950/50 text-slate-400 border-y border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium text-right">Current Value</th>
                  <th className="px-4 py-3 font-medium text-right">Current Weight</th>
                  <th className="px-4 py-3 font-medium text-right w-32">Target (%)</th>
                  <th className="px-4 py-3 font-medium text-right text-blue-400">Amount to Buy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {portfolioData?.assets.filter(a => a.quantity > 0).map((asset) => {
                  const currentValue = currency === "usd" ? asset.value_usd : asset.value_ils;
                  const currentTotalMarketValue = currentMetrics?.totalMarketValue || 0;
                  const currentWeight = currentTotalMarketValue > 0 ? (currentValue / currentTotalMarketValue) * 100 : 0;

                  const projectedTotalValue = currentTotalMarketValue + (Number(newCapital) || 0);
                  const targetValue = projectedTotalValue * ((targetWeights[asset.ticker] || 0) / 100);
                  const deficit = targetValue - currentValue;
                  const amountToBuy = deficit > 0 ? deficit : 0;

                  return (
                    <tr key={asset.ticker} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{asset.ticker}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{formatCurrency(currentValue, currency)}</td>
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
                          className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white text-right focus:outline-none focus:border-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-400">
                        {amountToBuy > 0 ? `+${formatCurrency(amountToBuy, currency)}` : "$0"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 w-full h-16 bg-slate-900 border-t border-slate-800 flex items-center justify-around z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.5)]">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`flex flex-col items-center justify-center gap-1 text-xs sm:text-sm font-medium transition-colors cursor-pointer ${activeTab === "dashboard" ? "text-blue-500" : "text-slate-400 hover:text-slate-200"}`}
        >
          <Activity className="w-5 h-5" />
          <span>Dashboard</span>
        </button>
        <button
          onClick={() => setActiveTab("holdings")}
          className={`flex flex-col items-center justify-center gap-1 text-xs sm:text-sm font-medium transition-colors cursor-pointer ${activeTab === "holdings" ? "text-blue-500" : "text-slate-400 hover:text-slate-200"}`}
        >
          <DollarSign className="w-5 h-5" />
          <span>Holdings</span>
        </button>
        <button
          onClick={() => setActiveTab("simulate")}
          className={`flex flex-col items-center justify-center gap-1 text-xs sm:text-sm font-medium transition-colors cursor-pointer ${activeTab === "simulate" ? "text-blue-500" : "text-slate-400 hover:text-slate-200"}`}
        >
          <Calculator className="w-5 h-5" />
          <span>Simulate</span>
        </button>
      </nav>
    </div>
  );
}