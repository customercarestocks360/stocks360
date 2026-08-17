import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import SpecularButton from "@/components/ui/specular-button";
import { OrbitRing, OtpVerification } from "@/components/ui/marketing";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Stocks360" },
      { name: "description", content: "Reset your Stocks360 account password." },
    ],
  }),
  component: ForgotPassword,
});

type Method = "email" | "phone";
type Step = "method" | "otp" | "reset" | "done";

function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method>("email");
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const handleResetSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords don't match.");
      return;
    }
    setPasswordError("");
    setStep("done");
  };

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground pt-safe pb-safe">
      <div className="relative h-full overflow-hidden">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="halo absolute inset-0" />

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.05]">
          <OrbitRing size={640} duration={70} dotCount={14} />
          <OrbitRing size={420} duration={50} dotCount={8} />
          <OrbitRing size={220} duration={32} dotCount={4} />
        </div>

        <div className="relative mx-auto flex h-full items-center justify-center px-6 py-4">
          {step === "otp" ? (
            <OtpVerification
              onBack={() => setStep("method")}
              onVerified={() => setStep("reset")}
              destination={method === "email" ? `the email ${contact || "on file"}` : `the phone number ${contact || "on file"}`}
            />
          ) : step === "done" ? (
            <div className="relative mx-auto w-full max-w-sm rounded-2xl border border-border bg-card/80 p-7 text-center shadow-2xl backdrop-blur-xl">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-primary">
                <i className="fa-solid fa-check text-base" />
              </div>
              <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">Password updated</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <SpecularButton
                type="button"
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
                className="mt-6 w-full uppercase tracking-[0.2em] font-bold"
                onClick={() => navigate({ to: "/login" })}
              >
                Back to sign in
              </SpecularButton>
            </div>
          ) : step === "reset" ? (
            <div className="relative w-full max-w-lg">
              <div className="absolute -top-16 -left-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-16 -right-10 h-56 w-56 rounded-full bg-[#3b82f6]/20 blur-3xl pointer-events-none" />

              <div className="relative rounded-3xl border border-border bg-card/80 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Set a new password
                </h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Choose a new password for your account.
                </p>

                <form className="mt-6 space-y-4" onSubmit={handleResetSubmit}>
                  <label className="block text-sm font-medium text-foreground">
                    New password
                    <Input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your new password"
                      className="mt-2 rounded-xl border-border bg-background/60 py-5 focus-visible:ring-primary/40"
                      type="password"
                    />
                  </label>
                  <label className="block text-sm font-medium text-foreground">
                    Confirm new password
                    <Input
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Enter your new password again"
                      className="mt-2 rounded-xl border-border bg-background/60 py-5 focus-visible:ring-primary/40"
                      type="password"
                    />
                  </label>

                  {passwordError && (
                    <p className="text-xs font-medium text-destructive">{passwordError}</p>
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
                    className="w-full uppercase tracking-[0.25em] font-bold"
                  >
                    Reset password
                  </SpecularButton>
                </form>
              </div>
            </div>
          ) : (
            <div className="relative w-full max-w-lg">
              <div className="absolute -top-16 -left-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-16 -right-10 h-56 w-56 rounded-full bg-[#3b82f6]/20 blur-3xl pointer-events-none" />

              <div className="relative rounded-3xl border border-border bg-card/80 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Reset your password
                </h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Tell us how you'd like to verify it's you, and we'll send a one-time code.
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMethod("email")}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-colors ${
                      method === "email"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <i className="fa-solid fa-envelope text-lg" />
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("phone")}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-colors ${
                      method === "phone"
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <i className="fa-solid fa-phone text-lg" />
                    Phone number
                  </button>
                </div>

                <form
                  className="mt-5 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setStep("otp");
                  }}
                >
                  <label className="block text-sm font-medium text-foreground">
                    {method === "email" ? "Email address" : "Phone number"}
                    <Input
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      placeholder={method === "email" ? "yourEmail@example.com" : "+1 (555) 000-0000"}
                      className="mt-2 rounded-xl border-border bg-background/60 py-5 focus-visible:ring-primary/40"
                      type={method === "email" ? "email" : "tel"}
                    />
                  </label>

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
                    disabled={!contact.trim()}
                    className="w-full uppercase tracking-[0.25em] font-bold disabled:opacity-40"
                  >
                    Send code
                  </SpecularButton>
                </form>

                <div className="mt-5 flex items-center justify-center border-t border-border pt-5 text-sm text-muted-foreground">
                  <Link to="/login" className="font-medium text-primary transition-colors hover:text-primary/80">
                    Back to sign in
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
