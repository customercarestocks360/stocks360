import { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { TickerBar } from "./TickerBar";
import { BottomTabBar } from "./BottomTabBar";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

export function AppLayout({ children }: { children: ReactNode }) {
  const settings = usePlatformSettings();
  return (
    <div className="flex min-h-screen-safe flex-col bg-background text-foreground">
      <TickerBar />
      <Header />
      {settings?.announcement && (
        <div
          role="status"
          className="border-b border-primary/20 bg-primary/10 px-4 py-2 text-center text-xs font-medium text-foreground"
        >
          <i className="fa-solid fa-bullhorn mr-2 text-primary" />
          {settings.announcement}
        </div>
      )}
      {/* Bottom padding on mobile reserves space for the fixed BottomTabBar so
          content never renders underneath it; md+ removes it since the tab bar
          is hidden there. */}
      <main className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </main>
      <Footer supportEmail={settings?.support_email ?? null} />
      <TickerBar bottom />
      <BottomTabBar />
    </div>
  );
}
