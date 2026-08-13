import { createFileRoute, Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create account — Stocks360" },
      { name: "description", content: "Create a new Stocks360 trading account." },
      { property: "og:title", content: "Create account — Stocks360" },
      {
        property: "og:description",
        content:
          "Sign up for Stocks360 and start trading from the same obsidian terminal experience.",
      },
    ],
  }),
  component: Signup,
});

function Signup() {

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen overflow-hidden py-10">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="halo absolute inset-0 opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_var(--color-primary-foreground),_transparent_34%),radial-gradient(circle_at_bottom_right,_var(--color-primary-foreground),_transparent_28%)] opacity-[0.08]" />
        <div className="relative mx-auto flex min-h-screen items-center justify-center px-6 py-6">
          <div className="w-full max-w-lg rounded-[2rem] border border-overlay-border bg-overlay p-8 shadow-[var(--glow)] backdrop-blur-xl">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Create your account
            </h1>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              Sign up for Stocks360 and access the same premium terminal experience.
            </p>
            <form className="space-y-5">
              <label className="block text-sm font-medium text-foreground">
                Full name
                <Input placeholder="Your name" className="mt-3" type="text" />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Email address
                <Input placeholder="yourEmail@example.com" className="mt-3" type="email" />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Password
                <Input placeholder="Enter your password" className="mt-3" type="password" />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Confirm password
                <Input placeholder="Enter your password again" className="mt-3" type="password" />
              </label>

              <button
                type="submit"
                className="w-full cursor-pointer rounded-2xl bg-primary py-4 font-mono text-sm font-bold uppercase tracking-[0.2em] text-primary-foreground shadow-md transition-opacity hover:opacity-90"
              >
                Create account
              </button>
            </form>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <p>Already have an account?</p>
              <Link to="/login" className="font-medium text-primary">
                Log in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
