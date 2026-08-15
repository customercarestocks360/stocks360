export type AssetType = "crypto" | "stock" | "forex";

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
  { sym: "BNB", name: "BNB", type: "crypto", color: "#f0b90b", icon: "fa-coins", price: "$964.88K", volume: "$18.4B", marketCap: "$142.6B", c1h: 0.12, c4h: 0.45, c24h: 0.81 },
  { sym: "BTC", name: "Bitcoin", type: "crypto", color: "#f7931a", icon: "fa-bitcoin-sign", price: "$99.78M", volume: "$22.04T", marketCap: "$2,002.88T", c1h: 0.08, c4h: 0.31, c24h: 0.52 },
  { sym: "ETH", name: "Ethereum", type: "crypto", color: "#627eea", icon: "fa-ethereum", price: "$2.97M", volume: "$6.66T", marketCap: "$359.59T", c1h: 0.15, c4h: 0.4, c24h: 0.74 },
  { sym: "GMEB", name: "GMEB", type: "crypto", color: "#a855f7", icon: "fa-coins", price: "$29.69K", volume: "$4.1B", marketCap: "$9.2B", c1h: 0.2, c4h: 0.5, c24h: 0.75 },
  { sym: "ASMLB", name: "ASMLB", type: "stock", color: "#3b82f6", icon: "fa-chart-line", price: "$2.92M", volume: "$3.3B", marketCap: "$18.4B", c1h: 0.1, c4h: 0.3, c24h: 0.48 },
  { sym: "ASTSB", name: "ASTSB", type: "stock", color: "#eab308", icon: "fa-chart-line", price: "$113.78K", volume: "$1.1B", marketCap: "$6.7B", c1h: -0.02, c4h: -0.01, c24h: -0.01 },
  { sym: "COW", name: "CoW Protocol", type: "crypto", color: "#f7d046", icon: "fa-coins", price: "$248.53", volume: "$184.11B", marketCap: "$142.61B", c1h: 4.2, c4h: 18.9, c24h: 57.31 },
  { sym: "WAL", name: "Walrus", type: "crypto", color: "#38bdf8", icon: "fa-water", price: "$43.85", volume: "$80.60B", marketCap: "$108.60B", c1h: 2.1, c4h: 12.4, c24h: 37.13 },
  { sym: "HEMI", name: "HEMI", type: "crypto", color: "#f97316", icon: "fa-coins", price: "$9.04", volume: "$55.85B", marketCap: "$8.94B", c1h: 1.4, c4h: 8.2, c24h: 22.53 },
  { sym: "USDT", name: "USDT", type: "crypto", color: "#26a17b", icon: "fa-dollar-sign", price: "$1.00", volume: "$50.93T", marketCap: "$289.66T", c1h: 0.0, c4h: 0.01, c24h: 0.02 },
  { sym: "MOVR", name: "Moonriver", type: "crypto", color: "#53cbc9", icon: "fa-moon", price: "$0.864", volume: "$32.88B", marketCap: "$17.41B", c1h: 1.1, c4h: 6.3, c24h: 18.84 },
  { sym: "NIL", name: "Nillion", type: "crypto", color: "#2563eb", icon: "fa-lock", price: "$0.04818", volume: "$85.48B", marketCap: "$38.97B", c1h: 0.9, c4h: 5.1, c24h: 15.04 },
  { sym: "USD/JPY", name: "US Dollar / Yen", type: "forex", color: "#10b981", icon: "fa-money-bill-transfer", price: "157.42", volume: "$210M", marketCap: "—", c1h: 0.05, c4h: 0.18, c24h: 0.41 },
  { sym: "EUR/USD", name: "Euro / US Dollar", type: "forex", color: "#3b82f6", icon: "fa-money-bill-transfer", price: "1.0892", volume: "$180M", marketCap: "—", c1h: -0.04, c4h: -0.09, c24h: -0.18 },
  { sym: "GBP/USD", name: "Pound / US Dollar", type: "forex", color: "#8b5cf6", icon: "fa-money-bill-transfer", price: "1.2731", volume: "$140M", marketCap: "—", c1h: 0.03, c4h: 0.11, c24h: 0.24 },
];

export const CATEGORY_PICKS: { title: string; syms: string[] }[] = [
  { title: "Hot", syms: ["BNB", "BTC", "ETH"] },
  { title: "New", syms: ["GMEB", "ASMLB", "ASTSB"] },
  { title: "Top Gainer", syms: ["COW", "WAL", "HEMI"] },
  { title: "Top Volume", syms: ["BTC", "ETH", "USDT"] },
];

export const TIME_OPTIONS = ["1h", "4h", "24h"] as const;
export type TimeOption = (typeof TIME_OPTIONS)[number];

export const TYPE_ROUTES: Record<AssetType, string> = {
  crypto: "/crypto",
  stock: "/stocks",
  forex: "/forex",
};

export function changeFor(asset: Asset, time: TimeOption) {
  return time === "1h" ? asset.c1h : time === "4h" ? asset.c4h : asset.c24h;
}

export function findAsset(sym: string) {
  return ASSETS.find((a) => a.sym === sym)!;
}

/**
 * Shared with crypto.tsx/stocks.tsx/forex.tsx so favoriting the same asset
 * on any page reflects everywhere it appears — while an asset of one type
 * never leaks into another type's favorites list.
 */
export function favKey(asset: Asset) {
  return `${asset.type}:${asset.sym}`;
}
