import { useEffect, useState } from "react";
import { fetchPlatformSettings, type PlatformSettings } from "@/lib/platform-api";

let cached: PlatformSettings | null = null;

export function usePlatformSettings() {
  const [settings, setSettings] = useState<PlatformSettings | null>(cached);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPlatformSettings(controller.signal)
      .then((next) => {
        cached = next;
        setSettings(next);
      })
      .catch(() => {
        // Public messaging is optional. Feature pages that require settings, such as
        // deposits, handle their own failure state explicitly.
      });
    return () => controller.abort();
  }, []);

  return settings;
}
