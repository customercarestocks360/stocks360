import { createFileRoute, Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import SpecularButton from "@/components/ui/specular-button";
import { useTheme } from "@/components/ThemeProvider";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Stocks360" },
      { name: "description", content: "Sign in to your Stocks360 account." },
      { property: "og:title", content: "Sign in — Stocks360" },
      {
        property: "og:description",
        content: "Access your trading workspace with the obsidian login experience.",
      },
    ],
  }),
  component: Login,
});

function Login() {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isDark = !mounted || theme === "dark";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen overflow-hidden py-10">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="halo absolute inset-0 opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_var(--color-primary-foreground),_transparent_34%),radial-gradient(circle_at_bottom_right,_var(--color-primary-foreground),_transparent_28%)] opacity-[0.08]" />
        <div className="relative mx-auto flex min-h-screen items-center justify-center px-6 py-6">
          <div className="w-full max-w-lg rounded-[2rem] border border-overlay-border bg-overlay p-8 shadow-[var(--glow)] backdrop-blur-xl">
            <div className="mb-8 space-y-6">
              <div className="inline-flex items-center gap-3 rounded-full border border-overlay-border bg-surface px-4 py-2 text-sm uppercase tracking-[0.3em] text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                Stocks360
              </div>
              <div>
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Welcome back</h1>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  Sign in to Stocks360 and access your trading terminal with a secure, sleek experience.
                </p>
              </div>
            </div>
            <form className="space-y-5">
              <label className="block text-sm font-medium text-foreground">
                Username
                <Input placeholder="username" className="mt-3" type="text" />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Password
                <Input placeholder="••••••••" className="mt-3" type="password" />
              </label>
              <div className="rounded-3xl border border-overlay-border bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Captcha verification</p>
                    <p className="mt-1 text-sm text-muted-foreground">Confirm you are human before signing in.</p>
                  </div>
                  <span className="rounded-full bg-surface-elevated px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-muted-foreground border border-overlay-border">
                    Secure
                  </span>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr]">
                  <label className="flex items-center gap-3 rounded-2xl border border-overlay-border bg-surface px-4 py-3 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 rounded border-border bg-background text-primary outline-none focus:ring-primary" />
                    <span className="text-sm text-foreground">I'm not a robot</span>
                  </label>
                  <div className="rounded-3xl border border-overlay-border bg-surface p-3">
                    <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.25em] text-muted-foreground">
                      <span>Image challenge</span>
                      <span>3/3</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="h-16 rounded-2xl bg-surface-elevated border border-overlay-border" />
                      <div className="h-16 rounded-2xl bg-surface-elevated border border-overlay-border" />
                      <div className="h-16 rounded-2xl bg-surface-elevated border border-overlay-border" />
                    </div>
                  </div>
                </div>
              </div>
              <SpecularButton
                type="submit"
                size="lg"
                radius={20}
                tint={isDark ? "#ffffff" : "#000000"}
                tintOpacity={0}
                blur={0}
                textColor={isDark ? "#f5f5f5" : "#1a1a1a"}
                lineColor={isDark ? "#ffffff" : "#000000"}
                baseColor={isDark ? "#34363e" : "#e5e5e5"}
                intensity={1}
                shineSize={12}
                shineFade={38}
                thickness={1}
                speed={0.35}
                followMouse
                proximity={240}
                autoAnimate={false}
                className="w-full uppercase tracking-[0.2em]"
              >
                Sign in
              </SpecularButton>
            </form>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <p>New to Stocks360?</p>
              <Link to="/signup" className="font-medium text-primary hover:text-primary-foreground">
                Create account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
