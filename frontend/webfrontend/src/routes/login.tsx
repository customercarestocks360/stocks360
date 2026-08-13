import { createFileRoute, Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen overflow-hidden py-10">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="halo absolute inset-0 opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_var(--color-primary-foreground),_transparent_34%),radial-gradient(circle_at_bottom_right,_var(--color-primary-foreground),_transparent_28%)] opacity-[0.08]" />
        <div className="relative mx-auto flex min-h-screen items-center justify-center px-6 py-6">
          <div className="w-full max-w-lg rounded-[2rem] border border-overlay-border bg-overlay p-8 shadow-[var(--glow)] backdrop-blur-xl">
            <div className="mb-8">
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                Welcome back
              </h1>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                Sign in to Stocks360 and access your trading terminal with a secure, sleek
                experience.
              </p>
            </div>
            <form className="space-y-5">
              <label className="block text-sm font-medium text-foreground">
                Username
                <Input placeholder="Enter your username" className="mt-3" type="text" />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Password
                <Input placeholder="Enter your password" className="mt-3" type="password" />
              </label>
              <button
                type="submit"
                className="w-full cursor-pointer rounded-2xl bg-primary py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-primary-foreground shadow-md transition-opacity hover:opacity-90"
              >
                Sign in
              </button>
            </form>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <p>New to Stocks360?</p>
              <Link to="/signup" className="font-medium text-primary">
                Create account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
