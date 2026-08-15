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

/** Demo-only conversion so INR and USDT amounts can share one axis/pie — no live FX feed exists. */
const USDT_TO_INR = 93;

function HistoryPage() {
  const { isLoggedIn, balances, transactions } = useAuth();

  const chronological = useMemo(() => [...transactions].reverse(), [transactions]);

  const investedSeries = useMemo(
    () =>
      chronological.map((t, i) => ({
        label: new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        invested: t.method === "INR" ? t.amount : t.amount * USDT_TO_INR,
        method: t.method,
        rawAmount: t.amount,
        key: `${t.id}-${i}`,
      })),
    [chronological],
  );

  const pnlSeries = useMemo(() => {
    let cumulative = 0;
    return chronological.map((t, i) => {
      cumulative += t.method === "INR" ? t.amount : t.amount * USDT_TO_INR;
      const fluctuation = 1 + 0.14 * Math.sin(i * 1.3 + 0.6) - 0.03 * i;
      return {
        label: new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        invested: Math.round(cumulative),
        value: Math.round(cumulative * fluctuation),
      };
    });
  }, [chronological]);

  const inrEquivFromUsdt = balances.USDT * USDT_TO_INR;
  const pieData = [
    { name: "INR", value: balances.INR, raw: `₹${balances.INR.toLocaleString()}` },
    { name: "USDT", value: inrEquivFromUsdt, raw: `${balances.USDT.toLocaleString()} USDT` },
  ];
  const hasHoldings = balances.INR > 0 || balances.USDT > 0;
  const PIE_COLORS = ["#3b82f6", "#26a17b"];

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
            <div className="mt-10 rounded-2xl border border-border bg-card p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
                <i className="fa-solid fa-lock text-lg" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-foreground">Sign in to view your history</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                You need to be signed in to see your transaction history.
              </p>
              <Link
                to="/login"
                className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">INR Balance</div>
                  <div className="mt-2 font-mono text-2xl font-bold text-foreground">
                    ₹{balances.INR.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">USDT Balance</div>
                  <div className="mt-2 font-mono text-2xl font-bold text-foreground">
                    {balances.USDT.toLocaleString()} USDT
                  </div>
                </div>
              </div>

              {transactions.length > 0 && (
                <div className="mt-10 grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <i className="fa-solid fa-chart-column text-primary" />
                      Money invested over time
                    </h3>
                    <p className="mb-4 text-xs text-muted-foreground">Each deposit, shown in ₹-equivalent.</p>
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
                            const label = p.method === "INR" ? `₹${p.rawAmount.toLocaleString()}` : `${p.rawAmount.toLocaleString()} USDT`;
                            return [label, "Deposited"];
                          }}
                        />
                        <Bar dataKey="invested" radius={[4, 4, 0, 0]} fill="var(--up)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <i className="fa-solid fa-chart-line text-primary" />
                      Profit / loss over time
                    </h3>
                    <p className="mb-4 text-xs text-muted-foreground">
                      Simulated portfolio value vs. amount invested (demo — not real trading data).
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
                            `₹${Number(value).toLocaleString()}`,
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

                  <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <i className="fa-solid fa-chart-pie text-primary" />
                      Current holdings split
                    </h3>
                    <p className="mb-4 text-xs text-muted-foreground">
                      INR vs USDT balance (USDT shown at a demo rate of ₹{USDT_TO_INR}/USDT for sizing).
                    </p>
                    {hasHoldings ? (
                      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                        <ResponsiveContainer width="100%" height={220} className="max-w-xs">
                          <PieChart>
                            <Pie
                              data={pieData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={55}
                              outerRadius={85}
                              paddingAngle={2}
                            >
                              {pieData.map((entry, i) => (
                                <Cell key={entry.name} fill={PIE_COLORS[i]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                background: "var(--card)",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                              formatter={(_value, _name, item) => [
                                (item.payload as (typeof pieData)[number]).raw,
                                item.payload.name,
                              ]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex gap-6 sm:flex-col sm:gap-3">
                          {pieData.map((d, i) => (
                            <div key={d.name} className="flex items-center gap-2 text-sm">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: PIE_COLORS[i] }}
                              />
                              <span className="font-medium text-foreground">{d.name}</span>
                              <span className="font-mono text-muted-foreground">{d.raw}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="py-10 text-center text-sm text-muted-foreground">
                        No holdings yet — make a deposit to see your split here.
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-card">
                {transactions.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    No transactions yet. Deposits you make will show up here.
                  </div>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-5 py-3 font-medium">Date</th>
                        <th className="px-5 py-3 font-medium">Type</th>
                        <th className="px-5 py-3 font-medium">Method</th>
                        <th className="px-5 py-3 text-right font-medium">Amount</th>
                        <th className="px-5 py-3 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((t) => (
                        <tr key={t.id} className="border-b border-border last:border-b-0">
                          <td className="px-5 py-4 text-muted-foreground">
                            {new Date(t.date).toLocaleString()}
                          </td>
                          <td className="px-5 py-4 text-foreground">Deposit</td>
                          <td className="px-5 py-4 text-foreground">{t.method}</td>
                          <td className="px-5 py-4 text-right font-mono font-semibold text-up">
                            +{t.method === "INR" ? "₹" : ""}
                            {t.amount.toLocaleString()}
                            {t.method === "USDT" ? " USDT" : ""}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <span className="rounded-full bg-up/10 px-2.5 py-0.5 text-xs font-semibold text-up">
                              Completed
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </AppLayout>
  );
}
