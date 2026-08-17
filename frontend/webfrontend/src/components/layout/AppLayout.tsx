import { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { TickerBar } from "./TickerBar";
import { BottomTabBar } from "./BottomTabBar";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen-safe flex-col bg-background text-foreground">
      <TickerBar />
      <Header />
      {/* Bottom padding on mobile reserves space for the fixed BottomTabBar so
          content never renders underneath it; md+ removes it since the tab bar
          is hidden there. */}
      <main className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </main>
      <Footer />
      <TickerBar bottom />
      <BottomTabBar />
    </div>
  );
}
