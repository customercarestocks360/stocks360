import { apiFetch } from "@/lib/api";
import type { FundingNetwork } from "@/lib/funding-api";

export type DepositRail = {
  currency: string;
  network: FundingNetwork;
  name: string;
  address: string;
  address_label: string;
  minimum: string;
  arrival: string;
  fee: string;
  confirmations: string;
  enabled: boolean;
};

export type PlatformSettings = {
  announcement: string | null;
  support_email: string | null;
  deposit_rails: DepositRail[];
  updated_at: string | null;
  updated_by: string | null;
};

export function fetchPlatformSettings(signal?: AbortSignal) {
  return apiFetch<PlatformSettings>("/platform/settings", { ...(signal ? { signal } : {}) });
}

export function adminFetchPlatformSettings(token: string) {
  return apiFetch<PlatformSettings>("/admin/settings", { token });
}

export function adminUpdatePlatformSettings(
  input: Partial<Pick<PlatformSettings, "announcement" | "support_email" | "deposit_rails">>,
  token: string,
) {
  return apiFetch<PlatformSettings>("/admin/settings", { method: "PATCH", token, body: input });
}
