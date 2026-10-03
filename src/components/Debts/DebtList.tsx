import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { LedgerState } from "../../hooks/useLedgerState";
import {
  debtBalanceAt,
  isPosted,
  monthKey,
  rupees,
  sumMoney,
  today,
  type LedgerAdjustment,
  type LedgerTransaction
} from "../../utils/ledgerLogic";

type Row = Record<string, unknown>;
type DebtRow = Row & { id: string };
type DebtListProps = {
  ledger: LedgerState;
  onSave: (update: LedgerState | ((current: LedgerState) => LedgerState)) => boolean;
};

type DebtFormValues = {
  name: string;
  principal: string;
  disbursed: string;
  initial: string;
  paidBeforeTracking: string;
  remaining: string;
  emi: string;
  remainingEmis: string;
  dueDay: string;
  principalPaidBefore: string;
  apr: string;
  balanceBasis: string;
  startMonth: string;
};

function records(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((item): item is Row =>
        typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function validTransactions(value: unknown): LedgerTransaction[] {
  return records(value).filter(
    (item): item is Row & LedgerTransaction =>
      typeof item.date === "string" &&
      typeof item.type === "string" &&
      Number.isFinite(Number(item.amount))
  );
}

function validAdjustments(value: unknown): LedgerAdjustment[] {
  return records(value).filter(
    (item): item is Row & LedgerAdjustment =>
      typeof item.kind === "string" &&
      typeof item.subjectId === "string" &&
      typeof item.date === "string" &&
      Number.isFinite(Number(item.amount))
  );
}

function debtRows(value: unknown): DebtRow[] {
  return records(value).filter((item): item is DebtRow => typeof item.id === "string");
}

function numeric(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyForm(startMonth: string): DebtFormValues {
  return {
    name: "",
    principal: "",
    disbursed: "",
    initial: "",
    paidBeforeTracking: "0",
    remaining: "",
    emi: "",
    remainingEmis: "",
    dueDay: "",
    principalPaidBefore: "",
    apr: "",
    balanceBasis: "unknown",
    startMonth
  };
}

function formForDebt(debt: DebtRow, currentBalance: number, remainingEmis: number): DebtFormValues {
  return {
    name: text(debt.name),
    principal: String(debt.principal ?? debt.initial ?? ""),
    disbursed: String(debt.disbursed ?? debt.principal ?? debt.initial ?? ""),
    initial: String(debt.initial ?? ""),
    paidBeforeTracking: String(debt.paidBeforeTracking ?? debt.legacyPaidBeforeEstimate ?? 0),
    remaining: String(currentBalance),
    emi: String(debt.emi ?? ""),
    remainingEmis: String(remainingEmis),
    dueDay: debt.dueDay == null ? "" : String(debt.dueDay),
    principalPaidBefore: debt.principalPaidBefore == null ? "" : String(debt.principalPaidBefore),
    apr: debt.apr == null ? "" : String(debt.apr),
    balanceBasis: text(debt.balanceBasis) || "unknown",
    startMonth: text(debt.startMonth)
  };
}

function asDebtRecord(debt: DebtRow) {
  return {
    id: debt.id,
    remaining: numeric(debt.remaining),
    ...(debt.balanceBaseline == null ? {} : { balanceBaseline: numeric(debt.balanceBaseline) })
  };
}

function scheduleAt(debt: DebtRow, month: string): { amount: number; dueDay: unknown } {
  const history = records(debt.scheduleHistory)
    .filter((row) => typeof row.from === "string" && row.from <= month)
    .sort((left, right) => text(left.from).localeCompare(text(right.from)));
  const row = history.at(-1);
  return row
    ? { amount: numeric(row.amount), dueDay: row.dueDay }
    : { amount: numeric(debt.emi), dueDay: debt.dueDay };
}

function remainingInstallments(
  debt: DebtRow,
  transactions: LedgerTransaction[],
  adjustments: LedgerAdjustment[],
  asOf: string
): number {
  const balance = debtBalanceAt(asDebtRecord(debt), asOf, transactions, adjustments);
  if (balance <= 0) return 0;
  const base = Number(debt.remainingEmis);
  if (!Number.isInteger(base)) {
    return numeric(debt.emi) > 0 ? Math.ceil(balance / numeric(debt.emi)) : 0;
  }

  const baselineMonth = text(debt.emiCountFromMonth) || monthKey(asOf);
  const baselineIds = new Set(
    Array.isArray(debt.emiCountBaselineTransactionIds)
      ? debt.emiCountBaselineTransactionIds.filter((value): value is string => typeof value === "string")
      : []
  );
  const grouped = new Map<string, number>();
  for (const transaction of transactions.filter((item) =>
    item.type === "emi" && item.debtId === debt.id && isPosted(item, asOf)
  )) {
    const billingMonth = text(transaction.billingMonth) || monthKey(transaction.date);
    if (billingMonth < baselineMonth ||
        billingMonth === baselineMonth &&
          (!debt.emiCountBaselineAt || baselineIds.has(text(transaction.id)))) continue;
    grouped.set(billingMonth, sumMoney([grouped.get(billingMonth) || 0, numeric(transaction.amount)]));
  }

  const fullEmiMonths = [...grouped].filter(([month, paid]) =>
    scheduleAt(debt, month).amount > 0 && paid + 0.005 >= scheduleAt(debt, month).amount
  ).length;
  return Math.max(0, base - fullEmiMonths);
}

export default function DebtList({ ledger, onSave }: DebtListProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const debts = debtRows(ledger.debts);
  const transactions = validTransactions(ledger.transactions);
  const adjustments = validAdjustments(ledger.adjustments);
  const currentMonth = monthKey(today());
  const monthReviews = records(ledger.monthReviews);
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [values, setValues] = useState<DebtFormValues>(() => emptyForm(currentMonth));
  const [error, setError] = useState("");

  const currentBalances = useMemo(
    () => new Map(debts.map((debt) => [
      debt.id,
      debtBalanceAt(asDebtRecord(debt), today(), transactions, adjustments)
    ])),
    [debts, transactions, adjustments]
  );

  const overview = useMemo(() => ({
    principal: sumMoney(debts.map((debt) => numeric(debt.principal ?? debt.initial))),
    disbursed: sumMoney(debts.map((debt) => numeric(debt.disbursed ?? debt.principal ?? debt.initial))),
    scheduled: sumMoney(debts.map((debt) => numeric(debt.initial))),
    paid: sumMoney(debts.map((debt) =>
      numeric(debt.paidBeforeTracking ?? debt.legacyPaidBeforeEstimate) +
      sumMoney(transactions.filter((transaction) =>
        transaction.debtId === debt.id && isPosted(transaction)
      ).map((transaction) => numeric(transaction.amount)))
    )),
    outstanding: sumMoney([...currentBalances.values()])
  }), [debts, transactions, currentBalances]);

  useEffect(() => {
    if (!dialogRef.current?.open) return;
    const updated = debts.find((debt) => debt.id === editingDebtId);
    if (editingDebtId && !updated) closeDialog();
  }, [debts, editingDebtId]);

  function openAddDialog() {
    setEditingDebtId(null);
    setValues(emptyForm(text(ledger.trackingStartMonth) || currentMonth));
    setError("");
    dialogRef.current?.showModal();
  }

  function openEditDialog(debt: DebtRow) {
    const balance = currentBalances.get(debt.id) ?? numeric(debt.remaining);
    setEditingDebtId(debt.id);
    setValues(formForDebt(debt, balance, remainingInstallments(debt, transactions, adjustments, today())));
    setError("");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
    setEditingDebtId(null);
    setError("");
  }

  function setField<K extends keyof DebtFormValues>(key: K, value: DebtFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = values.name.trim();
    const principal = Number(values.principal);
    const disbursed = Number(values.disbursed);
    const initial = Number(values.initial);
    const paidBeforeTracking = Number(values.paidBeforeTracking);
    const remaining = Number(values.remaining);
    const emi = Number(values.emi);
    const remainingEmis = Number(values.remainingEmis);
    const dueDay = values.dueDay.trim() === "" ? null : Number(values.dueDay);
    const apr = values.apr.trim() === "" ? null : Number(values.apr);
    const principalPaidBefore = values.principalPaidBefore.trim() === ""
      ? null
      : Number(values.principalPaidBefore);
    const validNumbers = [principal, disbursed, initial, paidBeforeTracking, remaining, emi, remainingEmis];

    if (!name || !validNumbers.every((amount) => Number.isFinite(amount) && amount >= 0) ||
        !Number.isInteger(remainingEmis) ||
        dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) ||
        apr !== null && (!Number.isFinite(apr) || apr < 0 || apr > 200) ||
        principalPaidBefore !== null && (!Number.isFinite(principalPaidBefore) || principalPaidBefore < 0)) {
      setError("Enter non-negative loan amounts. Remaining EMI count must be a whole number, and due day must be 1–31.");
      return;
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(values.startMonth)) {
      setError("Choose a valid schedule start month.");
      return;
    }

    const debt = editingDebtId ? debts.find((item) => item.id === editingDebtId) : null;
    if (editingDebtId && !debt) {
      setError("This debt no longer exists. Close the dialog and try again.");
      return;
    }
    if (monthReviews.some((review) => review.month === currentMonth)) {
      setError("Reopen this month's review before changing debt records.");
      return;
    }
    if (debt && debt.startMonth !== values.startMonth) {
      const affectedStart = values.startMonth < text(debt.startMonth) ? values.startMonth : text(debt.startMonth);
      if (monthReviews.some((review) => typeof review.month === "string" && review.month >= affectedStart)) {
        setError("Reopen affected closed months before changing the schedule start.");
        return;
      }
    }

    const saved = onSave((current) => {
      const existingDebts = Array.isArray(current.debts) ? current.debts : [];
      const existingTransactions = validTransactions(current.transactions);
      const currentAdjustments = validAdjustments(current.adjustments);
      const nextAdjustments = Array.isArray(current.adjustments) ? [...current.adjustments] : [];

      if (debt) {
        const previousBalance = debtBalanceAt(
          asDebtRecord(debt),
          today(),
          existingTransactions,
          currentAdjustments
        );
        const difference = Math.round((remaining - previousBalance) * 100) / 100;
        if (difference) {
          nextAdjustments.push({
            id: id("adjustment"),
            kind: "debt",
            subjectId: debt.id,
            date: today(),
            amount: difference,
            note: "Lender balance updated in debt details",
            created: Date.now()
          });
        }

        const history = records(debt.scheduleHistory)
          .filter((row) => row.from !== currentMonth);
        history.push({ from: currentMonth, amount: emi, dueDay });
        const updated: DebtRow = {
          ...debt,
          name,
          initial,
          principal,
          disbursed,
          paidBeforeTracking,
          remaining,
          emi,
          remainingEmis,
          dueDay,
          apr,
          principalPaidBefore,
          startMonth: values.startMonth,
          balanceBasis: values.balanceBasis,
          scheduleHistory: history.sort((left, right) => text(left.from).localeCompare(text(right.from))),
          emiCountFromMonth: currentMonth,
          emiCountBaselineAt: Date.now(),
          emiCountBaselineTransactionIds: existingTransactions
            .filter((transaction) => transaction.type === "emi" && transaction.debtId === debt.id)
            .map((transaction) => transaction.id)
        };
        return {
          ...current,
          debts: existingDebts.map((item) => item.id === debt.id ? updated : item),
          adjustments: nextAdjustments
        };
      }

      const newDebt: DebtRow = {
        id: id("debt"),
        name,
        initial,
        principal,
        disbursed,
        paidBeforeTracking,
        remaining,
        emi,
        remainingEmis,
        dueDay,
        balanceBaseline: remaining,
        emiCountFromMonth: currentMonth,
        emiCountBaselineAt: Date.now(),
        emiCountBaselineTransactionIds: [],
        apr,
        principalPaidBefore,
        startMonth: values.startMonth,
        balanceBasis: values.balanceBasis,
        scheduleHistory: [{ from: values.startMonth, amount: emi, dueDay }],
        note: ""
      };
      return { ...current, debts: [...existingDebts, newDebt] };
    });

    if (!saved) {
      setError("The debt changes were not saved. Check the storage warning and try again.");
      return;
    }
    closeDialog();
  }

  const currentMonthPayments = (debt: DebtRow) =>
    sumMoney(transactions
      .filter((transaction) =>
        transaction.type === "emi" &&
        transaction.debtId === debt.id &&
        (text(transaction.billingMonth) || monthKey(transaction.date)) === currentMonth &&
        isPosted(transaction)
      )
      .map((transaction) => numeric(transaction.amount)));

  const latestEmi = (debt: DebtRow) =>
    transactions
      .filter((transaction) =>
        transaction.type === "emi" &&
        transaction.debtId === debt.id &&
        monthKey(transaction.date) <= currentMonth &&
        isPosted(transaction)
      )
      .sort((left, right) =>
        right.date.localeCompare(left.date) || numeric(right.created) - numeric(left.created)
      )[0];

  return (
    <section className="rounded-panel border border-app-line bg-app-panel p-5 shadow-glow sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">EMI and debt schedule</h2>
          <p className="mt-1 text-sm text-app-muted">
            Track principal, disbursed amount, total repayment, current balance, and remaining EMIs separately.
          </p>
        </div>
        <button
          className="rounded-xl bg-app-green px-4 py-2.5 text-sm font-semibold text-app-bg hover:brightness-105"
          onClick={openAddDialog}
          type="button"
        >
          Add debt
        </button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Loan principal", rupees(overview.principal)],
          ["Amount disbursed", rupees(overview.disbursed)],
          ["Scheduled repayment", rupees(overview.scheduled)],
          ["Payments made", rupees(overview.paid)],
          ["Current outstanding", rupees(overview.outstanding)]
        ].map(([label, value]) => (
          <article className="rounded-xl border border-app-line bg-app-bg/60 p-4" key={label}>
            <p className="text-xs text-app-muted">{label}</p>
            <p className="mt-2 break-words text-lg font-semibold tabular-nums">{value}</p>
          </article>
        ))}
      </div>

      {debts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-app-line px-4 py-8 text-center text-sm text-app-muted">
          No EMI debts yet. Add your first debt to start tracking its schedule.
        </p>
      ) : (
        <div className="space-y-3">
          {debts.map((debt) => {
            const balance = currentBalances.get(debt.id) ?? numeric(debt.remaining);
            const paid = currentMonthPayments(debt);
            const due = numeric(debt.emi);
            const cleared = balance <= 0.005;
            const latest = latestEmi(debt);
            const status = cleared
              ? "Cleared"
              : paid + 0.005 >= due && due > 0
                ? `Paid · ${latest ? new Date(`${latest.date}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "this month"}`
                : `${rupees(Math.max(0, due - paid))} pending`;
            const count = remainingInstallments(debt, transactions, adjustments, today());

            return (
              <article className="grid gap-4 rounded-xl border border-app-line p-4 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(95px,0.7fr))_minmax(140px,1fr)_auto] lg:items-center" key={debt.id}>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{text(debt.name) || "Unnamed debt"}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-app-muted">
                    Loan {rupees(numeric(debt.principal ?? debt.initial))} · disbursed {rupees(numeric(debt.disbursed ?? debt.principal ?? debt.initial))} · total repay {rupees(numeric(debt.initial))}
                    {debt.dueDay ? ` · due day ${String(debt.dueDay)}` : ""}
                  </p>
                  {latest && (
                    <p className="mt-1 text-xs text-app-muted">
                      Latest EMI: {new Date(`${latest.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-app-muted">Monthly EMI</p>
                  <p className="mt-1 font-medium tabular-nums">{rupees(due)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-app-muted">Balance remaining</p>
                  <p className="mt-1 font-medium tabular-nums">{rupees(balance)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-app-muted">EMIs left</p>
                  <p className="mt-1 font-medium tabular-nums">{count}</p>
                </div>
                <div>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${cleared || paid + 0.005 >= due && due > 0 ? "bg-app-green-dark text-app-green" : "bg-app-gold/10 text-app-gold"}`}>
                    {status}
                  </span>
                  {!cleared && (
                    <p className="mt-1 text-xs text-app-muted">{rupees(paid)} paid this month</p>
                  )}
                </div>
                <button
                  className="rounded-lg border border-app-line px-3 py-2 text-xs font-semibold hover:border-app-green hover:text-app-green"
                  onClick={() => openEditDialog(debt)}
                  type="button"
                >
                  Edit
                </button>
              </article>
            );
          })}
        </div>
      )}

      <dialog
        className="m-auto max-h-[92vh] w-[min(760px,calc(100%-24px))] overflow-y-auto rounded-2xl border border-app-line bg-app-panel p-0 text-app-text shadow-2xl backdrop:bg-black/70"
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDialog();
        }}
        ref={dialogRef}
      >
        <form className="p-5 sm:p-7" onSubmit={submit}>
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">{editingDebtId ? "Edit EMI debt" : "Add EMI debt"}</h2>
              <p className="mt-1 text-sm text-app-muted">Enter the loan details together; you can edit them later.</p>
            </div>
            <button aria-label="Close debt editor" className="rounded-lg border border-app-line px-2.5 py-1 text-lg leading-none hover:border-app-muted" onClick={closeDialog} type="button">
              ×
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-app-muted sm:col-span-2">
              Debt / lender name
              <input autoFocus className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" maxLength={70} onChange={(event) => setField("name", event.target.value)} placeholder="e.g. Personal loan" required value={values.name} />
            </label>
            {([
              ["principal", "Loan amount / principal (₹)", "0.01"],
              ["disbursed", "Amount actually disbursed (₹)", "0.01"],
              ["initial", "Total repayment over loan (₹)", "0.01"],
              ["paidBeforeTracking", "Already paid before tracking (₹)", "0.01"],
              ["remaining", "Current balance remaining (₹)", "0.01"],
              ["emi", "Monthly EMI (₹)", "0.01"],
              ["remainingEmis", "Remaining EMI count", "1"]
            ] as const).map(([key, label, step]) => (
              <label className="block text-xs font-medium text-app-muted" key={key}>
                {label}
                <input
                  className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green"
                  min="0"
                  onChange={(event) => setField(key, event.target.value)}
                  required
                  step={step}
                  type="number"
                  value={values[key]}
                />
              </label>
            ))}
            <label className="block text-xs font-medium text-app-muted">
              Principal cleared before tracking (optional ₹)
              <input className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" min="0" onChange={(event) => setField("principalPaidBefore", event.target.value)} step="0.01" type="number" value={values.principalPaidBefore} />
            </label>
            <label className="block text-xs font-medium text-app-muted">
              Annual interest rate (optional %)
              <input className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" max="200" min="0" onChange={(event) => setField("apr", event.target.value)} step="0.01" type="number" value={values.apr} />
            </label>
            <label className="block text-xs font-medium text-app-muted">
              Balance entered represents
              <select className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" onChange={(event) => setField("balanceBasis", event.target.value)} value={values.balanceBasis}>
                <option value="unknown">Not confirmed</option>
                <option value="principal">Principal outstanding</option>
                <option value="scheduled">Remaining scheduled repayments</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-app-muted">
              Schedule starts from month
              <input className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" onChange={(event) => setField("startMonth", event.target.value)} required type="month" value={values.startMonth} />
            </label>
            <label className="block text-xs font-medium text-app-muted">
              Monthly EMI due day (optional)
              <input className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" max="31" min="1" onChange={(event) => setField("dueDay", event.target.value)} placeholder="1–31" step="1" type="number" value={values.dueDay} />
            </label>
          </div>

          <p className="mt-5 rounded-xl border border-app-line bg-app-bg/50 p-4 text-xs leading-relaxed text-app-muted">
            Outstanding-balance changes are recorded as dated adjustments, so past balances stay intact. Loan amount, disbursed amount, scheduled repayments, payments, and current balance are tracked separately.
          </p>

          {error && <p aria-live="polite" className="mt-4 text-sm text-app-red">{error}</p>}

          <div className="mt-6 flex justify-end gap-2">
            <button className="rounded-xl border border-app-line px-4 py-2.5 text-sm font-semibold hover:border-app-muted" onClick={closeDialog} type="button">
              Cancel
            </button>
            <button className="rounded-xl bg-app-green px-4 py-2.5 text-sm font-semibold text-app-bg hover:brightness-105" type="submit">
              {editingDebtId ? "Save changes" : "Save debt"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
