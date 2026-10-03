import { calculateDashboardMetrics, rupees } from "../../utils/ledgerLogic";

type MetricsGridProps = {
  ledger: Record<string, unknown>;
};

type Metric = {
  label: string;
  value: string;
  detail: string;
  emphasis?: boolean;
  tone?: "green" | "gold";
};

export default function MetricsGrid({ ledger }: MetricsGridProps) {
  const metrics = calculateDashboardMetrics(ledger);
  const cards: Metric[] = [
    {
      label: "Total debt remaining",
      value: rupees(metrics.remainingDebt),
      detail: `${metrics.debtCount} recorded debt${metrics.debtCount === 1 ? "" : "s"} · includes card and borrowed balances`,
      emphasis: true,
      tone: "green"
    },
    {
      label: "Debt cleared to date",
      value: rupees(metrics.debtCleared),
      detail: "Recorded principal reductions, card payments, and borrowed repayments"
    },
    {
      label: "This month's total due",
      value: rupees(metrics.totalDue),
      detail: "EMIs, commitments, and card statements"
    },
    {
      label: "This month paid / pending",
      value: `${rupees(metrics.paidThisMonth)} / ${rupees(metrics.pendingThisMonth)}`,
      detail: "Paid amount / remaining amount on this month's bills"
    },
    {
      label: "Daily debt target — today",
      value: rupees(metrics.targetToday),
      detail: metrics.deadlineDaysLeft > 0
        ? `${metrics.deadlineDaysLeft} calendar days left, including today`
        : "Deadline has passed",
      tone: "green"
    },
    {
      label: "Tomorrow if you miss today",
      value: rupees(metrics.targetTomorrowIfMissed),
      detail: "Today's unpaid target is spread over the remaining days",
      tone: "gold"
    },
    {
      label: "Bank + cash total",
      value: rupees(metrics.liquid),
      detail: "Current balances across bank and cash accounts"
    },
    {
      label: "Held for other people",
      value: rupees(metrics.held),
      detail: "Money to return or hand over"
    },
    {
      label: "Your own liquid money",
      value: rupees(metrics.ownLiquid),
      detail: "Bank + cash minus money held for others",
      emphasis: true
    },
    {
      label: "Rapido net this month",
      value: rupees(metrics.rapidoNet),
      detail: `${rupees(metrics.rapidoGross)} gross − ${rupees(metrics.rapidoCosts)} Rapido costs`
    },
    {
      label: "Rapido + extra income",
      value: rupees(metrics.rapidoNet + metrics.extraIncome),
      detail: "Rapido net earnings plus extra income this month"
    }
  ];

  return (
    <section aria-label="Debt and cash-flow overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {cards.map((metric) => (
        <article
          className={[
            "min-w-0 rounded-panel border p-5 shadow-glow",
            metric.emphasis
              ? "border-app-green/35 bg-gradient-to-br from-app-panel to-app-secondary"
              : "border-app-line bg-app-panel"
          ].join(" ")}
          key={metric.label}
        >
          <h2 className="text-xs font-medium text-app-muted">{metric.label}</h2>
          <p
            className={[
              "mt-3 break-words text-2xl font-semibold tabular-nums tracking-tight",
              metric.tone === "green"
                ? "text-app-green"
                : metric.tone === "gold"
                  ? "text-app-gold"
                  : "text-app-text"
            ].join(" ")}
          >
            {metric.value}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-app-muted">{metric.detail}</p>
        </article>
      ))}
    </section>
  );
}
