export type AssetType = "stock" | "forex";

export type Asset = {
  sym: string;
  name: string;
  type: AssetType;
  color: string;
  icon: string;
  price: string;
  volume: string;
  marketCap: string;
  c1h: number;
  c4h: number;
  c24h: number;
};

export const ASSETS: Asset[] = [
  { sym: "AAPL", name: "Apple Inc.", type: "stock", color: "#3b82f6", icon: "fa-chart-line", price: "$229.87", volume: "$58.2B", marketCap: "$3.5T", c1h: 0.05, c4h: 0.21, c24h: 0.88 },
  { sym: "MSFT", name: "Microsoft Corp.", type: "stock", color: "#10b981", icon: "fa-chart-line", price: "$415.32", volume: "$22.0B", marketCap: "$3.1T", c1h: 0.04, c4h: 0.18, c24h: 1.21 },
  { sym: "TSLA", name: "Tesla, Inc.", type: "stock", color: "#ef4444", icon: "fa-chart-line", price: "$248.53", volume: "$31.4B", marketCap: "$780B", c1h: -0.06, c4h: -0.3, c24h: -1.94 },
  { sym: "NVDA", name: "NVIDIA Corp.", type: "stock", color: "#8b5cf6", icon: "fa-chart-line", price: "$118.42", volume: "$45.7B", marketCap: "$2.9T", c1h: 0.12, c4h: 0.9, c24h: 3.45 },
  { sym: "GOOGL", name: "Alphabet Inc.", type: "stock", color: "#eab308", icon: "fa-chart-line", price: "$175.64", volume: "$18.3B", marketCap: "$2.2T", c1h: 0.02, c4h: 0.15, c24h: 0.62 },
  { sym: "USD/JPY", name: "US Dollar / Yen", type: "forex", color: "#10b981", icon: "fa-money-bill-transfer", price: "157.42", volume: "$210M", marketCap: "—", c1h: 0.05, c4h: 0.18, c24h: 0.41 },
  { sym: "EUR/USD", name: "Euro / US Dollar", type: "forex", color: "#3b82f6", icon: "fa-money-bill-transfer", price: "1.0892", volume: "$180M", marketCap: "—", c1h: -0.04, c4h: -0.09, c24h: -0.18 },
  { sym: "GBP/USD", name: "Pound / US Dollar", type: "forex", color: "#8b5cf6", icon: "fa-money-bill-transfer", price: "1.2731", volume: "$140M", marketCap: "—", c1h: 0.03, c4h: 0.11, c24h: 0.24 },
];

export const CATEGORY_PICKS: { title: string; syms: string[] }[] = [
  { title: "Hot", syms: ["AAPL", "NVDA", "TSLA"] },
  { title: "New", syms: ["GOOGL", "MSFT", "EUR/USD"] },
  { title: "Top Gainer", syms: ["NVDA", "TSLA", "USD/JPY"] },
  { title: "Top Volume", syms: ["AAPL", "MSFT", "GBP/USD"] },
];

export const TIME_OPTIONS = ["1h", "4h", "24h"] as const;
export type TimeOption = (typeof TIME_OPTIONS)[number];

export const TYPE_ROUTES: Record<AssetType, string> = {
  stock: "/trade",
  forex: "/forex",
};

export function changeFor(asset: Asset, time: TimeOption) {
  return time === "1h" ? asset.c1h : time === "4h" ? asset.c4h : asset.c24h;
}

export function findAsset(sym: string) {
  return ASSETS.find((a) => a.sym === sym)!;
}

/**
 * Shared with trade.tsx/forex.tsx so favoriting the same asset on any page
 * reflects everywhere it appears — while an asset of one type never leaks
 * into another type's favorites list.
 */
export function favKey(asset: Asset) {
  return `${asset.type}:${asset.sym}`;
}
