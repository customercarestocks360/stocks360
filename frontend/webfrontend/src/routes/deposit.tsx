import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { DepositPanel } from "@/components/ui/deposit-drawer";

export const Route = createFileRoute("/deposit")({
  head: () => ({
    meta: [
      { title: "Deposit — Stocks360" },
      { name: "description", content: "Deposit INR or USDT into your Stocks360 account." },
    ],
  }),
  component: DepositPage,
});

function DepositPage() {
  const navigate = useNavigate();
  const { isLoggedIn, kycCompleted } = useAuth();

  return (
    <AppLayout>
      <section className="relative min-h-[70vh] overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0 opacity-40" />

        <div className="relative mx-auto max-w-lg px-6 py-12">
          {!isLoggedIn ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <i className="fa-solid fa-lock text-lg" />
              </div>
              <h1 className="mt-4 text-xl font-bold text-foreground">Sign in required</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                You need to be signed in to deposit funds into your Stocks360 account.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
              >
                Go to sign in
              </Link>
            </div>
          ) : !kycCompleted ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <i className="fa-solid fa-id-card text-lg" />
              </div>
              <h1 className="mt-4 text-xl font-bold text-foreground">Account details incomplete</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Your identity hasn't been verified yet. Complete your account details to unlock deposits.
              </p>
              <Link
                to="/account"
                search={{ tab: "account" }}
                className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
              >
                Complete account details
              </Link>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-7">
              <DepositPanel onClose={() => navigate({ to: "/" })} />
            </div>
          )}
        </div>
      </section>
    </AppLayout>
  );
}
