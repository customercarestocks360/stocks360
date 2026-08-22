import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import SpecularButton from "@/components/ui/specular-button";
import { OrbitRing } from "@/components/ui/marketing";
import { firebaseAuthMessage, sendPasswordReset } from "@/lib/firebase";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Stocks360" },
      { name: "description", content: "Request a secure Stocks360 password-reset link." },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError("");
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      const message = firebaseAuthMessage(err);
      // Keep account existence private even if the Firebase project does not have email
      // enumeration protection enabled.
      if (message === "Incorrect email or password.") setSent(true);
      else setError(message ?? "Could not send the reset email. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground pt-safe pb-safe">
      <div className="relative h-full overflow-hidden">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="halo absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.05]">
          <OrbitRing size={640} duration={70} dotCount={14} />
          <OrbitRing size={420} duration={50} dotCount={8} />
          <OrbitRing size={220} duration={32} dotCount={4} />
        </div>

        <div className="relative mx-auto flex h-full items-center justify-center px-6 py-4">
          <div className="relative w-full max-w-lg">
            <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 -right-10 h-56 w-56 rounded-full bg-[#3b82f6]/20 blur-3xl" />
            <div className="relative rounded-3xl border border-border bg-card/80 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
              {sent ? (
                <div className="text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-up/10 text-up">
                    <i className="fa-solid fa-envelope-circle-check" />
                  </div>
                  <h1 className="mt-4 text-2xl font-bold">Check your email</h1>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    If an account exists for{" "}
                    <span className="font-medium text-foreground">{email.trim()}</span>, Firebase
                    has sent a signed, expiring reset link. Open that link to choose your new
                    password.
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Check spam or promotions before requesting another email.
                  </p>
                  <div className="mt-6 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSent(false);
                        setError("");
                      }}
                      className="rounded-xl border border-border px-4 py-3 text-sm font-semibold hover:bg-secondary"
                    >
                      Use another email
                    </button>
                    <Link
                      to="/login"
                      className="rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground"
                    >
                      Back to sign in
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
                    <i className="fa-solid fa-key" />
                  </div>
                  <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                    Reset your password
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Enter the email attached to your Stocks360 account. We’ll send the secure reset
                    link through Firebase Authentication.
                  </p>
                  <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
                    <label className="block text-sm font-medium">
                      Email address
                      <Input
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="you@example.com"
                        className="mt-2 rounded-xl border-border bg-background/60 py-5 focus-visible:ring-primary/40"
                        type="email"
                        required
                      />
                    </label>
                    {error && (
                      <p
                        role="alert"
                        className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
                      >
                        {error}
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
                      disabled={busy || !email.trim()}
                      className="w-full font-bold uppercase tracking-[0.22em] disabled:opacity-40"
                    >
                      {busy ? (
                        <>
                          <i className="fa-solid fa-circle-notch fa-spin" /> Sending
                        </>
                      ) : (
                        "Send reset link"
                      )}
                    </SpecularButton>
                  </form>
                  <div className="mt-5 border-t border-border pt-5 text-center text-sm text-muted-foreground">
                    <Link to="/login" className="font-medium text-primary hover:text-primary/80">
                      Back to sign in
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
