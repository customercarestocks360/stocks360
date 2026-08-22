import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import SpecularButton from "@/components/ui/specular-button";
import { OrbitRing, GoogleIcon } from "@/components/ui/marketing";
import { useAuth } from "@/components/AuthProvider";

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

/** Firebase's own floor, and the bound `SignupRequest.password` declares on the backend. */
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

function Signup() {
  const navigate = useNavigate();
  const { signUpWithEmail, signInWithGoogle, isLoggedIn, authReady, authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"email" | "google" | null>(null);
  /** Set once the account exists and the verification link is on its way. */
  const [sentTo, setSentTo] = useState("");

  useEffect(() => {
    if (authReady && isLoggedIn) void navigate({ to: "/", replace: true });
  }, [authReady, isLoggedIn, navigate]);

  const handleDetailsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;

    // Checked here as well as by the backend, purely so the user hears about it without a
    // round-trip. The backend's bounds are the ones that actually enforce anything.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setError("");
    setPending("email");
    try {
      // POST /auth/signup creates the account and Firebase mails the verification link.
      // No navigation: the account cannot be used until that link is clicked, so the next
      // step is the inbox, then /login.
      await signUpWithEmail(email, password);
      setSentTo(email.trim());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create your account. Please try again.",
      );
    } finally {
      setPending(null);
    }
  };

  const handleGoogle = async () => {
    if (pending) return;
    setError("");
    setPending("google");
    try {
      // Google needs no separate signup: the first successful sign-in creates the Firebase
      // user, and POST /auth/login mirrors it into MongoDB.
      const signedIn = await signInWithGoogle();
      if (signedIn) await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const message = error || authError || "";
  const busy = pending !== null;

  // The account exists but is unusable until the link is clicked, so the form has nothing
  // left to collect — the only next step is the inbox.
  if (sentTo) {
    return (
      <div className="h-dvh overflow-hidden bg-background text-foreground pt-safe pb-safe">
        <div className="relative h-full overflow-hidden">
          <div className="grid-bg absolute inset-0 opacity-40" />
          <div className="halo absolute inset-0" />
          <div className="relative mx-auto flex h-full items-center justify-center px-6 py-4">
            <div className="w-full max-w-lg rounded sm:rounded-3xl border border-border bg-card/80 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Confirm your email</h1>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                We sent a verification link to <span className="text-foreground">{sentTo}</span>.
                Click it, then log in — the account stays locked until you do.
              </p>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Nothing in your inbox? Check the spam folder, or try logging in — that sends a fresh
                link.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-block font-medium text-primary transition-colors hover:text-primary/80"
              >
                Go to log in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground pt-safe pb-safe">
      <div className="relative h-full overflow-hidden">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="halo absolute inset-0" />

        {/* Ambient orbit rings — decorative, matches homepage cinematic sections */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.05]">
          <OrbitRing size={640} duration={70} dotCount={14} />
          <OrbitRing size={420} duration={50} dotCount={8} />
        </div>

        {/* Glow blobs behind the card */}
        <div className="absolute left-1/2 top-1/2 -z-0 h-[420px] w-[420px] -translate-x-[60%] -translate-y-[55%] rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 -z-0 h-[360px] w-[360px] translate-x-[10%] translate-y-[35%] rounded-full bg-[#3b82f6]/10 blur-3xl" />

        <div className="relative mx-auto flex h-full items-center justify-center px-6 py-4">
          <div className="relative max-h-[94vh] w-full max-w-lg overflow-hidden rounded sm:rounded-3xl border border-border bg-card/80 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
            <div className="absolute top-0 right-0 h-56 w-56 opacity-[0.08] pointer-events-none">
              <div className="h-full w-full rounded-full bg-primary blur-3xl" />
            </div>

            <div className="relative">
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Create your account
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Sign up for Stocks360 and access the same premium terminal experience.
              </p>

              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="mt-6 flex w-full items-center justify-center gap-3 rounded sm:rounded-xl border border-border bg-white py-3 text-sm font-semibold text-[#1f1f1f] shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
              >
                <GoogleIcon />
                {pending === "google" ? "Opening Google…" : "Continue with Google"}
              </button>

              <div className="my-5 flex items-center gap-3 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Or sign up with email
                <span className="h-px flex-1 bg-border" />
              </div>

              <form className="space-y-4" onSubmit={handleDetailsSubmit}>
                <label className="block text-sm font-medium text-foreground">
                  Email address
                  <Input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="yourEmail@example.com"
                    className="mt-2 rounded sm:rounded-xl"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={busy}
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Password
                  <Input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="mt-2 rounded sm:rounded-xl"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    maxLength={MAX_PASSWORD_LENGTH}
                    required
                    disabled={busy}
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Confirm password
                  <Input
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Enter your password again"
                    className="mt-2 rounded sm:rounded-xl"
                    type="password"
                    autoComplete="new-password"
                    maxLength={MAX_PASSWORD_LENGTH}
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
                  className="w-full uppercase tracking-[0.2em] font-bold disabled:opacity-50"
                >
                  {pending === "email" ? "Creating account…" : "Create account"}
                </SpecularButton>
              </form>

              <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-mono text-muted-foreground">
                {["Verified email", "Server-side account ledger", "Reviewed QR funding"].map(
                  (c) => (
                    <span key={c} className="flex items-center gap-2">
                      <span className="text-primary font-bold">✓</span>
                      {c}
                    </span>
                  ),
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
                <p>Already have an account?</p>
                <Link
                  to="/login"
                  className="font-medium text-primary transition-colors hover:text-primary/80"
                >
                  Log in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
