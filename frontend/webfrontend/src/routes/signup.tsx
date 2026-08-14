import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import SpecularButton from "@/components/ui/specular-button";
import { OrbitRing, GoogleIcon, OtpVerification } from "@/components/ui/marketing";
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

function Signup() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [step, setStep] = useState<"details" | "otp">("details");

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
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
          {step === "otp" ? (
            <OtpVerification
              onBack={() => setStep("details")}
              onVerified={() => {
                login();
                navigate({ to: "/" });
              }}
            />
          ) : (
          <div className="relative max-h-[94vh] w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-card/80 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
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
                className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-white py-3 text-sm font-semibold text-[#1f1f1f] shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
              >
                <GoogleIcon />
                Continue with Google
              </button>

              <div className="my-5 flex items-center gap-3 text-xs font-mono uppercase tracking-widest text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Or sign up with email
                <span className="h-px flex-1 bg-border" />
              </div>

              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setStep("otp");
                }}
              >
                <label className="block text-sm font-medium text-foreground">
                  Full name
                  <Input placeholder="Your name" className="mt-2 rounded-xl" type="text" />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Email address
                  <Input placeholder="yourEmail@example.com" className="mt-2 rounded-xl" type="email" />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Password
                  <Input placeholder="Enter your password" className="mt-2 rounded-xl" type="password" />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Confirm password
                  <Input placeholder="Enter your password again" className="mt-2 rounded-xl" type="password" />
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
                  className="w-full uppercase tracking-[0.2em] font-bold"
                >
                  Create account
                </SpecularButton>
              </form>

              <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-mono text-muted-foreground">
                {["No deposit fees", "SOC 2 Type II", "Protected by 2FA"].map((c) => (
                  <span key={c} className="flex items-center gap-2">
                    <span className="text-primary font-bold">✓</span>
                    {c}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
                <p>Already have an account?</p>
                <Link to="/login" className="font-medium text-primary transition-colors hover:text-primary/80">
                  Log in
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
