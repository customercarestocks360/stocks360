import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/components/AuthProvider";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Transaction History — Stocks360" },
      { name: "description", content: "View your past deposits and account activity." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { isLoggedIn, balances, transactions } = useAuth();

  const chronological = useMemo(() => [...transactions].reverse(), [transactions]);

  const investedSeries = useMemo(
    () =>
      chronological.map((t, i) => ({
        label: new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        invested: t.amount,
        method: t.method,
        rawAmount: t.amount,
        key: `${t.id}-${i}`,
      })),
    [chronological],
  );

  const pnlSeries = useMemo(() => {
    let cumulative = 0;
    return chronological.map((t, i) => {
      cumulative += t.amount;
      const fluctuation = 1 + 0.14 * Math.sin(i * 1.3 + 0.6) - 0.03 * i;
      return {
        label: new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        invested: Math.round(cumulative * 100) / 100,
        value: Math.round(cumulative * fluctuation * 100) / 100,
      };
    });
  }, [chronological]);

  const totalDeposited = useMemo(() => transactions.reduce((acc, t) => acc + t.amount, 0), [transactions]);

  return (
    <AppLayout>
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-bg absolute inset-0 opacity-40" />

        <div className="relative mx-auto max-w-5xl px-6 py-16">
          <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Transaction history
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Every deposit made to your Stocks360 account, most recent first.
          </p>

          {!isLoggedIn ? (
            <div className="mt-10 rounded sm:rounded-2xl border border-border bg-card p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
                <i className="fa-solid fa-lock text-lg" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-foreground">Sign in to view your history</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                You need to be signed in to see your transaction history.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded sm:rounded-2xl border border-border bg-card p-5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">USDT Available</div>
                  <div className="mt-2 font-mono text-2xl font-bold text-foreground">
                    {balances.USDT.toLocaleString()} USDT
                  </div>
                </div>
                <div className="rounded sm:rounded-2xl border border-border bg-card p-5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Total Deposited</div>
                  <div className="mt-2 font-mono text-2xl font-bold text-foreground">
                    {totalDeposited.toLocaleString()} USDT
                  </div>
                </div>
              </div>

              {transactions.length > 0 && (
                <div className="mt-10 grid gap-6 lg:grid-cols-2">
                  <div className="rounded sm:rounded-2xl border border-border bg-card p-5">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <i className="fa-solid fa-chart-column text-primary" />
                      Money invested over time
                    </h3>
                    <p className="mb-4 text-xs text-muted-foreground">Each deposit in USDT.</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={investedSeries} margin={{ left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            background: "var(--card)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          formatter={(_value, _name, item) => {
                            const p = item.payload as (typeof investedSeries)[number];
                            return [`${p.rawAmount.toLocaleString()} USDT`, "Deposited"];
                          }}
                        />
                        <Bar dataKey="invested" radius={[4, 4, 0, 0]} fill="var(--up)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded sm:rounded-2xl border border-border bg-card p-5">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <i className="fa-solid fa-chart-line text-primary" />
                      Portfolio value over time
                    </h3>
                    <p className="mb-4 text-xs text-muted-foreground">
                      Simulated portfolio value in USDT vs. amount invested.
                    </p>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={pnlSeries} margin={{ left: -20 }}>
                        <defs>
                          <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                        <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            background: "var(--card)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          formatter={(value, name) => [
                            `${Number(value).toLocaleString()} USDT`,
                            name === "invested" ? "Invested" : "Portfolio value",
                          ]}
                        />
                        <Legend
                          formatter={(v) => (v === "invested" ? "Invested" : "Portfolio value")}
                          wrapperStyle={{ fontSize: 11 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="invested"
                          stroke="var(--muted-foreground)"
                          fill="none"
                          strokeDasharray="4 3"
                          strokeWidth={1.5}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="var(--primary)"
                          fill="url(#pnlGradient)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="mt-10 overflow-hidden rounded sm:rounded-2xl border border-border bg-card">
                {transactions.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    No transactions yet. Deposits you make will show up here.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Date</th>
                        <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Type</th>
                        <th className="px-2 py-2 sm:px-5 sm:py-3 font-medium">Method</th>
                        <th className="px-2 py-2 sm:px-5 sm:py-3 text-right font-medium">Amount</th>
                        <th className="px-2 py-2 sm:px-5 sm:py-3 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((t) => (
                        <tr key={t.id} className="border-b border-border last:border-b-0">
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 text-muted-foreground">
                            {new Date(t.date).toLocaleString()}
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 text-foreground">Deposit</td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 text-foreground">{t.method}</td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 text-right font-mono font-semibold text-up">
                            +{t.amount.toLocaleString()} USDT
                          </td>
                          <td className="px-2 py-2.5 sm:px-5 sm:py-4 text-right">
                            <span className="rounded-full bg-up/10 px-2.5 py-0.5 text-xs font-semibold text-up">
                              Completed
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </AppLayout>
  );
}
