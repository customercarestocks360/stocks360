import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import SpecularButton from "@/components/ui/specular-button";
import { OrbitRing, GoogleIcon } from "@/components/ui/marketing";
import { useAuth } from "@/components/AuthProvider";

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
  const navigate = useNavigate();
  const { signInWithEmail, signInWithGoogle, isLoggedIn, authReady, authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"email" | "google" | null>(null);

  // A restored session makes this page a no-op — send them where they were going instead of
  // showing a form that would only append a second login event.
  useEffect(() => {
    if (authReady && isLoggedIn) void navigate({ to: "/", replace: true });
  }, [authReady, isLoggedIn, navigate]);

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setError("");
    setPending("email");
    try {
      // Firebase checks the password, then the backend verifies the resulting ID token and
      // records the login. Either both happen or the user is not signed in.
      await signInWithEmail(email, password);
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign you in. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const handleGoogle = async () => {
    if (pending) return;
    setError("");
    setPending("google");
    try {
      const signedIn = await signInWithGoogle();
      if (signedIn) await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed. Please try again.");
    } finally {
      setPending(null);
    }
  };

  // The credential error takes precedence: it is the one the user just caused.
  const message = error || authError || "";
  const busy = pending !== null;

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground pt-safe pb-safe">
      <div className="relative h-full overflow-hidden">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="halo absolute inset-0" />

        {/* Ambient orbit rings, echoing the homepage's cinematic sections */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.05]">
          <OrbitRing size={640} duration={70} dotCount={14} />
          <OrbitRing size={420} duration={50} dotCount={8} />
          <OrbitRing size={220} duration={32} dotCount={4} />
        </div>

        <div className="relative mx-auto flex h-full items-center justify-center px-6 py-4">
          <div className="relative w-full max-w-lg">
            {/* Glow blobs behind the card */}
            <div className="absolute -top-16 -left-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -right-10 h-56 w-56 rounded-full bg-[#3b82f6]/20 blur-3xl pointer-events-none" />

            <div className="relative max-h-[92vh] overflow-y-auto rounded-3xl border border-border bg-card/80 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
              <div className="mb-6">
                <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Welcome back
                </h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Sign in to Stocks360 and access your trading terminal with a secure, sleek
                  experience.
                </p>
              </div>

              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-white py-3 text-sm font-semibold text-[#1f1f1f] shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
              >
                <GoogleIcon />
                {pending === "google" ? "Opening Google…" : "Continue with Google"}
              </button>

              <div className="my-5 flex items-center gap-3 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Or sign in with email
                <span className="h-px flex-1 bg-border" />
              </div>

              <form className="space-y-4" onSubmit={handleEmailSubmit}>
                <label className="block text-sm font-medium text-foreground">
                  Email address
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="yourEmail@example.com"
                    className="mt-2 rounded-xl border-border bg-background/60 py-5 focus-visible:ring-primary/40"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={busy}
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  <div className="flex items-center justify-between">
                    Password
                    <Link
                      to="/forgot-password"
                      className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="mt-2 rounded-xl border-border bg-background/60 py-5 focus-visible:ring-primary/40"
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={busy}
                  />
                </label>

                {message && (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {message}
                  </p>
                )}

                <SpecularButton
                  type="submit"
                  size="lg"
                  radius={16}
                  tint="#000000"
                  tintOpacity={1}
                  blur={0}
                  textColor="#ffffff"
                  lineColor="#ffffff"
                  baseColor="#000000"
                  intensity={1}
                  shineSize={10}
                  shineFade={40}
                  thickness={1}
                  speed={0.35}
                  followMouse
                  proximity={250}
                  autoAnimate={false}
                  disabled={busy}
                  className="w-full uppercase tracking-[0.25em] font-bold disabled:opacity-50"
                >
                  {pending === "email" ? "Signing in…" : "Sign in"}
                </SpecularButton>
              </form>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
                <p>New to Stocks360?</p>
                <Link
                  to="/signup"
                  className="font-medium text-primary transition-colors hover:text-primary/80"
                >
                  Create account
                </Link>
              </div>
            </div>

            <div className="label-mono mt-4 text-center">Protected by 2FA · SOC 2 Type II</div>
          </div>
        </div>
      </div>
    </div>
  );
}
