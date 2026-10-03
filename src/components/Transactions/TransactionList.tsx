import { useEffect, useMemo, useState } from "react";
import type { LedgerState } from "../../hooks/useLedgerState";
import {
  debtPrincipalReduction,
  isPosted,
  monthKey,
  rupees,
  synchronizeDebtBalances,
  type LedgerAdjustment,
  type LedgerTransaction
} from "../../utils/ledgerLogic";

type Row = Record<string, unknown>;
type TransactionListProps = {
  ledger: LedgerState;
  onSave: (update: LedgerState | ((current: LedgerState) => LedgerState)) => boolean;
  onEdit: (transaction: LedgerTransaction) => void;
  onDeleted?: (id: string) => void;
};

const CATEGORIES: Record<string, string> = {
  food: "Food & groceries",
  transport: "Transport",
  rapido: "Rapido operating costs",
  bills: "Bills",
  medical: "Medical",
  personal: "Personal",
  other: "Other"
};

const TYPE_NAMES: Record<string, string> = {
  refund: "Refund / cashback",
  charge: "Account interest / fee",
  lended: "Borrowed from someone",
  lendReturn: "Repay borrowed money",
  rapido: "Rapido earning",
  extra: "Extra earning",
  salary: "Fixed salary",
  expense: "Expense",
  commitment: "Monthly commitment",
  emi: "EMI payment",
  debt: "Debt payment",
  cardPayment: "Credit card payment",
  transfer: "Account transfer",
  heldIn: "Money held for someone",
  heldOut: "Return held money"
};

const INCOMING_TYPES = new Set(["salary", "rapido", "extra", "heldIn", "refund", "lended"]);

function records(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((item): item is Row =>
        typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function transactionsOf(value: unknown): LedgerTransaction[] {
  return records(value).filter(
    (item): item is Row & LedgerTransaction =>
      typeof item.date === "string" &&
      typeof item.type === "string" &&
      Number.isFinite(Number(item.amount))
  );
}

function adjustmentsOf(value: unknown): LedgerAdjustment[] {
  return records(value).filter(
    (item): item is Row & LedgerAdjustment =>
      typeof item.kind === "string" &&
      typeof item.subjectId === "string" &&
      typeof item.date === "string" &&
      Number.isFinite(Number(item.amount))
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function transactionTitle(transaction: LedgerTransaction, debtName: string): string {
  return stringValue(transaction.note) ||
    debtName ||
    stringValue(transaction.borrowedFrom) ||
    stringValue(transaction.borrowRepaidTo) ||
    stringValue(transaction.lendedTo) ||
    stringValue(transaction.lendReturnedFrom) ||
    stringValue(transaction.heldPerson) ||
    stringValue(transaction.heldTransferPerson) ||
    TYPE_NAMES[transaction.type] ||
    transaction.type;
}

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function TransactionList({
  ledger,
  onSave,
  onEdit,
  onDeleted
}: TransactionListProps) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [deletedTransaction, setDeletedTransaction] = useState<LedgerTransaction | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState(false);

  const transactions = transactionsOf(ledger.transactions);
  const accounts = records(ledger.accounts);
  const debts = records(ledger.debts);
  const accountNames = new Map(
    accounts
      .filter((account) => typeof account.id === "string")
      .map((account) => [String(account.id), stringValue(account.name) || "Unnamed account"])
  );
  const debtNames = new Map(
    debts
      .filter((debt) => typeof debt.id === "string")
      .map((debt) => [String(debt.id), stringValue(debt.name) || "Unnamed debt"])
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim().toLocaleLowerCase()), 180);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!deletedTransaction) return;
    const timer = window.setTimeout(() => setDeletedTransaction(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [deletedTransaction]);

  const filteredTransactions = useMemo(() => {
    return [...transactions]
      .filter((transaction) => {
        if (typeFilter && transaction.type !== typeFilter) return false;
        if (categoryFilter) {
          if (transaction.type !== "expense") return false;
          if (categoryFilter === "uncategorized" ? Boolean(transaction.category) : transaction.category !== categoryFilter) {
            return false;
          }
        }
        if (monthFilter && monthKey(transaction.date) !== monthFilter) return false;
        if (accountFilter &&
            transaction.accountId !== accountFilter &&
            transaction.transferFromAccountId !== accountFilter &&
            transaction.transferToAccountId !== accountFilter) return false;
        if (search) {
          const linkedDebt = debtNames.get(stringValue(transaction.debtId)) || "";
          const values = [
            transaction.note,
            transaction.heldPerson,
            transaction.heldTransferPerson,
            transaction.borrowedFrom,
            transaction.borrowRepaidTo,
            transaction.lendedTo,
            transaction.lendReturnedFrom,
            transaction.category ? CATEGORIES[stringValue(transaction.category)] : "",
            TYPE_NAMES[transaction.type],
            linkedDebt
          ];
          if (!values.some((value) => String(value || "").toLocaleLowerCase().includes(search))) return false;
        }
        return true;
      })
      .sort((left, right) =>
        right.date.localeCompare(left.date) || (Number(right.created) || 0) - (Number(left.created) || 0)
      );
  }, [transactions, typeFilter, categoryFilter, monthFilter, accountFilter, search, debtNames]);

  function deleteTransaction(transaction: LedgerTransaction) {
    if (!window.confirm("Delete this transaction? This will undo its effect on account and debt balances.")) return;
    const saved = onSave((current) => {
      const existingRows = Array.isArray(current.transactions) ? current.transactions : [];
      const nextRows = existingRows.filter((item) => item.id !== transaction.id);
      return {
        ...current,
        debts: synchronizeDebtBalances(
          records(current.debts),
          transactionsOf(existingRows),
          transactionsOf(nextRows),
          adjustmentsOf(current.adjustments)
        ),
        transactions: nextRows
      };
    });
    if (!saved) {
      setNotice("The transaction was not deleted because the latest data could not be saved.");
      setActionError(true);
      return;
    }
    setDeletedTransaction(transaction);
    setNotice(`Deleted ${TYPE_NAMES[transaction.type] || transaction.type} · ${rupees(transaction.amount)}.`);
    setActionError(false);
    if (transaction.id) onDeleted?.(transaction.id);
  }

  function undoDelete() {
    if (!deletedTransaction?.id) return;
    const saved = onSave((current) => {
      const existingRows = Array.isArray(current.transactions) ? current.transactions : [];
      if (existingRows.some((item) => item.id === deletedTransaction.id)) return current;
      const nextRows = [...existingRows, deletedTransaction];
      return {
        ...current,
        debts: synchronizeDebtBalances(
          records(current.debts),
          transactionsOf(existingRows),
          transactionsOf(nextRows),
          adjustmentsOf(current.adjustments)
        ),
        transactions: nextRows
      };
    });
    if (!saved) {
      setNotice("Undo was not saved. Reload the latest data before trying again.");
      setActionError(true);
      return;
    }
    setDeletedTransaction(null);
    setNotice("Transaction restored.");
    setActionError(false);
  }

  const typeOptions = [
    ["rapido", "Rapido earning"],
    ["extra", "Extra earning"],
    ["salary", "Fixed salary"],
    ["expense", "Expense"],
    ["commitment", "Fixed commitment"],
    ["emi", "EMI payment"],
    ["debt", "Debt payment"],
    ["cardPayment", "Credit card payment"],
    ["transfer", "Account transfer"],
    ["heldIn", "Money held for someone"],
    ["heldOut", "Return held money"],
    ["refund", "Refund / cashback"],
    ["charge", "Account interest / fee"],
    ["lended", "Borrowed from someone"],
    ["lendReturn", "Repay borrowed money"]
  ];

  return (
    <section className="rounded-panel border border-app-line bg-app-panel p-5 shadow-glow sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Transaction history</h2>
          <p className="mt-1 text-sm text-app-muted">
            Search, filter, edit, or delete your entries. A deleted transaction can be restored for 10 seconds.
          </p>
        </div>
        <span className="text-xs text-app-muted">
          {filteredTransactions.length} of {transactions.length} entries
        </span>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-xs font-medium text-app-muted">
          Search description or person
          <input
            className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none placeholder:text-app-muted/60 focus:border-app-green"
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search transactions..."
            type="search"
            value={searchInput}
          />
        </label>
        <label className="block text-xs font-medium text-app-muted">
          Transaction type
          <select className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
            <option value="">All types</option>
            {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-app-muted">
          Expense category
          <select className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
            <option value="">All expense categories</option>
            <option value="uncategorized">Uncategorized (older entries)</option>
            {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-app-muted">
          Account
          <select className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" onChange={(event) => setAccountFilter(event.target.value)} value={accountFilter}>
            <option value="">All accounts</option>
            {accounts.filter((account) => typeof account.id === "string").map((account) => (
              <option key={String(account.id)} value={String(account.id)}>{stringValue(account.name) || "Unnamed account"}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-app-muted">
          Month
          <input className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green" onChange={(event) => setMonthFilter(event.target.value)} type="month" value={monthFilter} />
        </label>
      </div>

      {notice && (
        <div aria-live="polite" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-line px-4 py-3 text-sm">
          <span className={actionError ? "text-app-red" : "text-app-muted"}>{notice}</span>
          {deletedTransaction && !actionError && (
            <button className="font-semibold text-app-green hover:underline" onClick={undoDelete} type="button">
              Undo
            </button>
          )}
        </div>
      )}

      {filteredTransactions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-app-line px-4 py-8 text-center text-sm text-app-muted">
          {transactions.length ? "No transactions match these filters." : "No transactions logged yet. Your first entry will appear here."}
        </p>
      ) : (
        <div className="divide-y divide-app-line/80">
          {filteredTransactions.map((transaction, index) => {
            const type = transaction.type;
            const incoming = INCOMING_TYPES.has(type);
            const debtName = debtNames.get(stringValue(transaction.debtId)) || "";
            const label = transactionTitle(transaction, debtName);
            const isTransfer = type === "transfer";
            const accountLabel = isTransfer
              ? `${accountNames.get(stringValue(transaction.transferFromAccountId)) || "—"} → ${accountNames.get(stringValue(transaction.transferToAccountId)) || "—"}`
              : accountNames.get(stringValue(transaction.accountId)) || "—";
            const details = [
              TYPE_NAMES[type] || type,
              !isPosted(transaction) ? "PLANNED" : "",
              transaction.billingMonth ? `period ${String(transaction.billingMonth)}` : "",
              type === "expense" ? CATEGORIES[stringValue(transaction.category)] || "Uncategorized" : "",
              type === "lended" ? `borrowed from ${stringValue(transaction.borrowedFrom || transaction.lendedTo) || "Unknown lender"}` : "",
              type === "lendReturn" ? `repaid to ${stringValue(transaction.borrowRepaidTo || transaction.lendReturnedFrom) || "Unknown lender"}` : "",
              transaction.heldPerson ? `held for ${String(transaction.heldPerson)}` : "",
              transaction.heldTransferPerson && Number(transaction.heldTransferAmount) > 0
                ? `${rupees(Number(transaction.heldTransferAmount))} held for ${String(transaction.heldTransferPerson)} moved`
                : "",
              transaction.heldFundsPerson && Number(transaction.heldFundsUsed) > 0
                ? `${rupees(Number(transaction.heldFundsUsed))} from held funds for ${String(transaction.heldFundsPerson)} (still owed)`
                : "",
              transaction.debtId && (transaction.debtInterest != null || transaction.debtFees != null)
                ? `principal ${rupees(debtPrincipalReduction(transaction))} · interest ${rupees(Number(transaction.debtInterest) || 0)} · fees ${rupees(Number(transaction.debtFees) || 0)}`
                : ""
            ].filter(Boolean);
            const key = stringValue(transaction.id) || `${transaction.date}-${transaction.type}-${index}`;

            return (
              <article className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(85px,0.6fr)_minmax(0,2fr)_minmax(110px,1fr)_auto] sm:items-center" key={key}>
                <time className="text-xs text-app-muted" dateTime={transaction.date}>{dateLabel(transaction.date)}</time>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{label}</h3>
                  <p className="mt-1 break-words text-xs leading-relaxed text-app-muted">{details.join(" · ")}</p>
                </div>
                <span className="text-xs text-app-muted">{accountLabel}</span>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <strong className={`whitespace-nowrap text-sm tabular-nums ${isTransfer ? "text-app-text" : incoming ? "text-app-green" : "text-app-red"}`}>
                    {incoming ? "+" : isTransfer ? "" : "−"}{rupees(Number(transaction.amount))}
                  </strong>
                  <div className="flex shrink-0 gap-1">
                    <button
                      aria-label={`Edit ${label}`}
                      className="rounded-lg border border-app-line px-2.5 py-1.5 text-xs font-medium hover:border-app-green hover:text-app-green"
                      onClick={() => onEdit(transaction)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      aria-label={`Delete ${label}`}
                      className="grid h-8 w-8 place-items-center rounded-lg border border-app-line text-lg leading-none text-app-red hover:border-app-red"
                      onClick={() => deleteTransaction(transaction)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
