import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { LedgerState } from "../../hooks/useLedgerState";
import {
  isPosted,
  monthKey,
  paise,
  rupees,
  sumMoney,
  today,
  type LedgerTransaction
} from "../../utils/ledgerLogic";

type Row = Record<string, unknown>;
type Commitment = Row & { id: string };
type CommitmentValues = {
  name: string;
  amount: string;
  dueDay: string;
};
type CommitmentListProps = {
  ledger: LedgerState;
  onSave: (update: LedgerState | ((current: LedgerState) => LedgerState)) => boolean;
};

const INPUT_CLASS =
  "w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green";
const LABEL_CLASS = "block text-xs font-medium text-app-muted";

function records(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((item): item is Row =>
        typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function commitmentRows(value: unknown): Commitment[] {
  return records(value).filter((item): item is Commitment => typeof item.id === "string");
}

function transactionsOf(value: unknown): LedgerTransaction[] {
  return records(value).filter(
    (item): item is Row & LedgerTransaction =>
      typeof item.date === "string" &&
      typeof item.type === "string" &&
      Number.isFinite(Number(item.amount))
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numeric(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function makeId(): string {
  return `commitment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function scheduleAt(commitment: Commitment, month: string): { amount: number; dueDay: unknown } {
  const history = records(commitment.scheduleHistory)
    .filter((entry) => typeof entry.from === "string" && entry.from <= month)
    .sort((left, right) => text(left.from).localeCompare(text(right.from)));
  const schedule = history.at(-1);
  return schedule
    ? { amount: numeric(schedule.amount), dueDay: schedule.dueDay }
    : { amount: numeric(commitment.amount), dueDay: commitment.dueDay };
}

function monthReviews(value: unknown): Row[] {
  return records(value);
}

export default function CommitmentList({ ledger, onSave }: CommitmentListProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const currentMonth = monthKey(today());
  const allCommitments = commitmentRows(ledger.commitments);
  const transactions = transactionsOf(ledger.transactions);
  const activeCommitments = useMemo(
    () => allCommitments.filter((commitment) =>
      (!text(commitment.startMonth) || text(commitment.startMonth) <= currentMonth) &&
      (!text(commitment.endMonth) || text(commitment.endMonth) >= currentMonth)
    ),
    [allCommitments, currentMonth]
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<CommitmentValues>({ name: "", amount: "", dueDay: "" });
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const locked = monthReviews(ledger.monthReviews).some((review) => review.month === currentMonth);

  const paymentSummary = useMemo(() => {
    const posted = transactions.filter((transaction) =>
      transaction.type === "commitment" &&
      (text(transaction.billingMonth) || monthKey(transaction.date)) === currentMonth &&
      isPosted(transaction)
    );
    return new Map(activeCommitments.map((commitment) => [
      commitment.id,
      sumMoney(posted
        .filter((transaction) => transaction.commitmentId === commitment.id)
        .map((transaction) => numeric(transaction.amount)))
    ]));
  }, [activeCommitments, currentMonth, transactions]);

  useEffect(() => {
    if (!dialogRef.current?.open || !editingId) return;
    if (!activeCommitments.some((commitment) => commitment.id === editingId)) closeDialog();
  }, [activeCommitments, editingId]);

  function openAddDialog() {
    setEditingId(null);
    setValues({ name: "", amount: "", dueDay: "" });
    setFormError("");
    dialogRef.current?.showModal();
  }

  function openEditDialog(commitment: Commitment) {
    const schedule = scheduleAt(commitment, currentMonth);
    setEditingId(commitment.id);
    setValues({
      name: text(commitment.name),
      amount: String(schedule.amount),
      dueDay: schedule.dueDay == null ? "" : String(schedule.dueDay)
    });
    setFormError("");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
    setEditingId(null);
    setFormError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = values.name.trim();
    const amount = Number(values.amount);
    const dueDay = values.dueDay.trim() === "" ? null : Number(values.dueDay);
    if (!name || values.amount.trim() === "" || !Number.isFinite(amount) ||
        amount < 0 || !Number.isSafeInteger(paise(amount)) ||
        dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
      setFormError("Enter a name, a non-negative monthly amount, and a due day from 1–31 or leave it blank.");
      return;
    }
    if (locked) {
      setFormError("Reopen this month's review before changing commitments.");
      return;
    }

    const existing = editingId
      ? activeCommitments.find((commitment) => commitment.id === editingId)
      : undefined;
    if (editingId && !existing) {
      setFormError("This commitment is no longer active. Close the dialog and try again.");
      return;
    }

    const saved = onSave((current) => {
      const currentCommitments = commitmentRows(current.commitments);
      if (existing) {
        const history = records(existing.scheduleHistory)
          .filter((entry) => entry.from !== currentMonth);
        history.push({ from: currentMonth, amount, dueDay });
        history.sort((left, right) => text(left.from).localeCompare(text(right.from)));
        const updated: Commitment = {
          ...existing,
          name,
          amount,
          dueDay,
          scheduleHistory: history
        };
        return {
          ...current,
          commitments: currentCommitments.map((item) =>
            item.id === existing.id ? updated : item
          )
        };
      }

      return {
        ...current,
        commitments: [
          ...currentCommitments,
          {
            id: makeId(),
            name,
            amount,
            dueDay,
            startMonth: currentMonth,
            scheduleHistory: [{ from: currentMonth, amount, dueDay }]
          }
        ]
      };
    });

    if (!saved) {
      setFormError("Commitment was not saved. Check the storage warning and try again.");
      return;
    }
    closeDialog();
    setMessage(existing ? "Commitment updated. Previous monthly schedules are preserved." : "Commitment added.");
    setMessageIsError(false);
  }

  function archive(commitment: Commitment) {
    if (locked) {
      setMessage("Reopen this month's review before archiving a commitment.");
      setMessageIsError(true);
      return;
    }
    if (!window.confirm(`Archive ${text(commitment.name) || "this commitment"} after this month? This month's obligation and payment history will remain.`)) {
      return;
    }
    const saved = onSave((current) => ({
      ...current,
      commitments: commitmentRows(current.commitments).map((item) =>
        item.id === commitment.id ? { ...item, endMonth: currentMonth } : item
      )
    }));
    setMessage(saved ? "Commitment archived after this month." : "Commitment was not archived. Check the storage warning.");
    setMessageIsError(!saved);
  }

  return (
    <section className="rounded-panel border border-app-line bg-app-panel p-5 shadow-glow sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Fixed monthly commitments</h2>
          <p className="mt-1 text-sm text-app-muted">
            Track monthly bills, due dates, and payments. Schedule edits apply this month onward; past schedules stay intact.
          </p>
        </div>
        <button
          className="rounded-xl bg-app-green px-4 py-2.5 text-sm font-semibold text-app-bg hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={locked}
          onClick={openAddDialog}
          type="button"
        >
          + Add commitment
        </button>
      </div>

      {locked && (
        <p className="mb-4 rounded-xl border border-app-gold/40 bg-app-bg/50 p-3 text-xs text-app-gold">
          This month's review is closed. Reopen it before changing or archiving commitments.
        </p>
      )}

      {activeCommitments.length === 0 ? (
        <p className="rounded-xl border border-dashed border-app-line px-4 py-6 text-sm text-app-muted">
          No active commitments for {currentMonth}. Add one to include it in monthly obligations.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {activeCommitments.map((commitment) => {
            const schedule = scheduleAt(commitment, currentMonth);
            const paid = paymentSummary.get(commitment.id) || 0;
            const remaining = Math.max(0, Math.round((schedule.amount - paid) * 100) / 100);
            const dueDay = Number(schedule.dueDay);
            const dueLabel = Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31
              ? `Due day ${dueDay}`
              : "No fixed due day";
            const status = remaining <= 0.005
              ? "Paid"
              : paid > 0
                ? "Partially paid"
                : "Pending";

            return (
              <article className="rounded-xl border border-app-line bg-app-bg/50 p-4" key={commitment.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{text(commitment.name) || "Unnamed commitment"}</h3>
                    <p className="mt-1 text-xs text-app-muted">{dueLabel} · {status}</p>
                  </div>
                  <button
                    aria-label={`Edit ${text(commitment.name) || "commitment"}`}
                    className="rounded-lg border border-app-line px-3 py-1.5 text-xs font-semibold hover:border-app-green disabled:opacity-50"
                    disabled={locked}
                    onClick={() => openEditDialog(commitment)}
                    type="button"
                  >
                    Edit
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-app-line pt-3 text-xs">
                  <div>
                    <p className="text-app-muted">Due this month</p>
                    <p className="mt-1 font-semibold tabular-nums">{rupees(schedule.amount)}</p>
                  </div>
                  <div>
                    <p className="text-app-muted">Paid</p>
                    <p className="mt-1 font-semibold tabular-nums text-app-green">{rupees(paid)}</p>
                  </div>
                  <div>
                    <p className="text-app-muted">Remaining</p>
                    <p className="mt-1 font-semibold tabular-nums">{rupees(remaining)}</p>
                  </div>
                </div>
                <button
                  className="mt-4 text-xs font-medium text-app-muted underline decoration-app-line underline-offset-4 hover:text-app-red disabled:opacity-50"
                  disabled={locked}
                  onClick={() => archive(commitment)}
                  type="button"
                >
                  Archive after this month
                </button>
              </article>
            );
          })}
        </div>
      )}

      {message && (
        <p aria-live="polite" className={`mt-4 text-sm ${messageIsError ? "text-app-red" : "text-app-green"}`}>
          {message}
        </p>
      )}

      <dialog
        className="w-[min(100%-2rem,32rem)] rounded-2xl border border-app-line bg-app-panel p-0 text-app-text shadow-2xl backdrop:bg-black/70"
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDialog();
        }}
        onClose={() => setEditingId(null)}
        ref={dialogRef}
      >
        <form className="space-y-4 p-5 sm:p-6" onSubmit={submit}>
          <div>
            <h3 className="text-lg font-semibold">{editingId ? "Edit commitment" : "Add commitment"}</h3>
            <p className="mt-1 text-xs text-app-muted">Changes take effect from {currentMonth} and preserve earlier schedule history.</p>
          </div>
          <label className={LABEL_CLASS}>
            Commitment name
            <input
              autoFocus
              className={`${INPUT_CLASS} mt-1.5`}
              maxLength={80}
              onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              required
              value={values.name}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL_CLASS}>
              Monthly amount (₹)
              <input
                className={`${INPUT_CLASS} mt-1.5`}
                min="0"
                onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))}
                required
                step="0.01"
                type="number"
                value={values.amount}
              />
            </label>
            <label className={LABEL_CLASS}>
              Due day (optional)
              <input
                className={`${INPUT_CLASS} mt-1.5`}
                max="31"
                min="1"
                onChange={(event) => setValues((current) => ({ ...current, dueDay: event.target.value }))}
                placeholder="1–31"
                step="1"
                type="number"
                value={values.dueDay}
              />
            </label>
          </div>
          {formError && <p aria-live="polite" className="text-sm text-app-red">{formError}</p>}
          <div className="flex justify-end gap-2 border-t border-app-line pt-4">
            <button
              className="rounded-xl border border-app-line px-4 py-2.5 text-sm font-semibold hover:border-app-green"
              onClick={closeDialog}
              type="button"
            >
              Cancel
            </button>
            <button className="rounded-xl bg-app-green px-4 py-2.5 text-sm font-semibold text-app-bg" type="submit">
              Save commitment
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
