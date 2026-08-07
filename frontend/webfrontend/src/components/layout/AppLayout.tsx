import { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { TickerBar } from "./TickerBar";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TickerBar />
      <Header />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
      <TickerBar bottom />
    </div>
  );
}
