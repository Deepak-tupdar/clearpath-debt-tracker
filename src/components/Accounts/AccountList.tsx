import { useMemo, useState } from "react";
import type { LedgerState } from "../../hooks/useLedgerState";
import {
  accountBalanceAtDate,
  debtBalanceAt,
  paise,
  rupees,
  roundMoney,
  today,
  validDate,
  type LedgerAccount,
  type LedgerAdjustment,
  type LedgerTransaction
} from "../../utils/ledgerLogic";

type Row = Record<string, unknown>;
type AccountRow = Row & { id: string; kind: string };
type DebtRow = Row & { id: string };
type AccountListProps = {
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

function accountRows(value: unknown): AccountRow[] {
  return records(value).filter(
    (row): row is AccountRow => typeof row.id === "string" && typeof row.kind === "string"
  );
}

function debtRows(value: unknown): DebtRow[] {
  return records(value).filter((row): row is DebtRow => typeof row.id === "string");
}

function transactionsOf(value: unknown): LedgerTransaction[] {
  return records(value).filter(
    (row): row is Row & LedgerTransaction =>
      typeof row.date === "string" &&
      typeof row.type === "string" &&
      Number.isFinite(Number(row.amount))
  );
}

function adjustmentsOf(value: unknown): LedgerAdjustment[] {
  return records(value).filter(
    (row): row is Row & LedgerAdjustment =>
      typeof row.kind === "string" &&
      typeof row.subjectId === "string" &&
      typeof row.date === "string" &&
      Number.isFinite(Number(row.amount))
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function asAccount(account: AccountRow): LedgerAccount {
  return {
    id: account.id,
    kind: account.kind,
    opening: numeric(account.opening),
    ...(typeof account.openingDate === "string" ? { openingDate: account.openingDate } : {})
  };
}

function asDebt(debt: DebtRow) {
  return {
    id: debt.id,
    remaining: numeric(debt.remaining),
    ...(debt.balanceBaseline == null ? {} : { balanceBaseline: numeric(debt.balanceBaseline) })
  };
}

function signedRupees(amount: number): string {
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${rupees(Math.abs(amount))}`;
}

export default function AccountList({ ledger, onSave }: AccountListProps) {
  const accounts = accountRows(ledger.accounts);
  const debts = debtRows(ledger.debts);
  const transactions = transactionsOf(ledger.transactions);
  const adjustments = adjustmentsOf(ledger.adjustments);
  const statementRows = records(ledger.statementReconciliations);
  const accountIdMap = new Map(accounts.map((account) => [account.id, stringValue(account.name)]));
  const debtIdMap = new Map(debts.map((debt) => [debt.id, stringValue(debt.name)]));
  const [actualValues, setActualValues] = useState<Record<string, string>>({});
  const [accountSelection, setAccountSelection] = useState("");
  const [accountStatementDate, setAccountStatementDate] = useState(today());
  const [accountReported, setAccountReported] = useState("");
  const [debtSelection, setDebtSelection] = useState("");
  const [debtStatementDate, setDebtStatementDate] = useState(today());
  const [debtReported, setDebtReported] = useState("");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  const accountBalances = useMemo(() => new Map(
    accounts.map((account) => [
      account.id,
      accountBalanceAtDate(asAccount(account), today(), transactions, adjustments)
    ])
  ), [accounts, transactions, adjustments]);

  const accountHistory = useMemo(
    () => statementRows
      .filter((row) => row.kind === "account")
      .sort((left, right) =>
        stringValue(right.date).localeCompare(stringValue(left.date)) ||
        numeric(right.created) - numeric(left.created)
      )
      .slice(0, 8),
    [statementRows]
  );

  const debtHistory = useMemo(() => {
    const allDebtRecords = statementRows
      .filter((row) => row.kind === "debt")
      .sort((left, right) =>
        stringValue(left.date).localeCompare(stringValue(right.date)) ||
        numeric(left.created) - numeric(right.created)
      );
    const priorBalance = new Map<string, number>();
    const changeById = new Map<string, number | null>();
    for (const record of allDebtRecords) {
      const id = stringValue(record.subjectId);
      changeById.set(
        stringValue(record.id),
        priorBalance.has(id) ? numeric(record.reported) - (priorBalance.get(id) || 0) : null
      );
      priorBalance.set(id, numeric(record.reported));
    }
    return {
      records: [...allDebtRecords].reverse().slice(0, 8),
      changeById
    };
  }, [statementRows]);

  function report(messageText: string, isError = false) {
    setMessage(messageText);
    setMessageIsError(isError);
  }

  function addCashAccount() {
    if (accounts.some((account) => account.kind === "cash")) {
      report("A cash account already exists. Update its opening balance from the account card.", true);
      return;
    }
    const saved = onSave((current) => ({
      ...current,
      accounts: [
        ...(Array.isArray(current.accounts) ? current.accounts : []),
        { id: makeId("account"), name: "Cash", kind: "cash", opening: 0 }
      ]
    }));
    if (saved) report("Cash account added with a zero opening balance.");
    else report("Cash account was not added. Check the storage warning.", true);
  }

  function reconcileActualBalance(account: AccountRow) {
    const value = actualValues[account.id] ?? String(accountBalances.get(account.id) ?? 0);
    if (value.trim() === "" || !Number.isFinite(Number(value)) ||
        !Number.isSafeInteger(paise(Number(value)))) {
      report("Enter a valid actual balance for this account.", true);
      return;
    }
    const actual = roundMoney(Number(value));
    const balance = accountBalanceAtDate(asAccount(account), today(), transactions, adjustments);
    const difference = roundMoney(actual - balance);
    if (Math.abs(difference) < 0.005) {
      report("This account already matches the ledger balance.");
      return;
    }
    const adjustment = {
      id: makeId("adjustment"),
      kind: "account",
      subjectId: account.id,
      date: today(),
      amount: difference,
      note: "Account balance updated to actual balance",
      created: Date.now()
    };
    const saved = onSave((current) => ({
      ...current,
      adjustments: [
        ...(Array.isArray(current.adjustments) ? current.adjustments : []),
        adjustment
      ]
    }));
    if (saved) {
      report(`${stringValue(account.name)} reconciled to ${rupees(actual)}.`);
      setActualValues((current) => {
        const next = { ...current };
        delete next[account.id];
        return next;
      });
    } else {
      report("Balance adjustment was not saved. Check the storage warning.", true);
    }
  }

  function saveStatement(kind: "account" | "debt") {
    const isAccount = kind === "account";
    const subjectId = isAccount ? accountSelection : debtSelection;
    const date = isAccount ? accountStatementDate : debtStatementDate;
    const value = isAccount ? accountReported : debtReported;
    const reported = Number(value);
    if (!validDate(date) || date > today() || value.trim() === "" ||
        !Number.isFinite(reported) || !Number.isSafeInteger(paise(reported)) ||
        !isAccount && reported < 0) {
      report("Choose a record, a statement date no later than today, and a valid balance.", true);
      return;
    }

    let subjectName: string;
    let calculated: number;
    if (isAccount) {
      const account = accounts.find((item) => item.id === subjectId);
      if (!account) {
        report("Choose a valid account.", true);
        return;
      }
      subjectName = stringValue(account.name);
      calculated = accountBalanceAtDate(asAccount(account), date, transactions, adjustments);
    } else {
      const debt = debts.find((item) => item.id === subjectId);
      if (!debt) {
        report("Choose a valid debt or lender.", true);
        return;
      }
      subjectName = stringValue(debt.name);
      calculated = debtBalanceAt(asDebt(debt), date, transactions, adjustments);
    }
    const record = {
      id: makeId("reconciliation"),
      kind,
      subjectId,
      subjectName,
      date,
      reported: roundMoney(reported),
      calculated,
      difference: roundMoney(reported - calculated),
      followupStatus: "open",
      followupNote: "",
      created: Date.now()
    };
    const saved = onSave((current) => ({
      ...current,
      statementReconciliations: [
        ...(Array.isArray(current.statementReconciliations) ? current.statementReconciliations : []),
        record
      ]
    }));
    if (!saved) {
      report("Statement comparison was not saved. Check the storage warning.", true);
      return;
    }
    if (isAccount) setAccountReported("");
    else setDebtReported("");
    const difference = roundMoney(reported - calculated);
    report(Math.abs(difference) <= 0.005
      ? "Statement matches the recorded balance."
      : `Statement saved for comparison. Difference: ${signedRupees(difference)}. Ledger balances were not changed.`);
  }

  function updateFollowup(id: string, field: "followupStatus" | "followupNote", value: string) {
    const saved = onSave((current) => ({
      ...current,
      statementReconciliations: (Array.isArray(current.statementReconciliations)
        ? current.statementReconciliations
        : []).map((record) =>
          record.id === id ? { ...record, [field]: value } : record
        )
    }));
    if (!saved) report("Follow-up update was not saved. Check the storage warning.", true);
  }

  function renderReconciliationRows(rows: Row[], kind: "account" | "debt") {
    if (!rows.length) {
      return (
        <p className="rounded-lg border border-dashed border-app-line px-3 py-4 text-xs text-app-muted">
          No {kind === "account" ? "account" : "lender"} statements compared yet.
        </p>
      );
    }

    return (
      <div className="overflow-x-auto rounded-xl border border-app-line">
        <table className="w-full min-w-[660px] text-left text-xs">
          <thead className="bg-app-bg/70 text-app-muted">
            <tr>
              <th className="p-3 font-medium">{kind === "account" ? "Account" : "Lender"} · date</th>
              <th className="p-3 text-right font-medium">Reported</th>
              {kind === "debt" && <th className="p-3 text-right font-medium">Change</th>}
              <th className="p-3 text-right font-medium">Tracker</th>
              <th className="p-3 text-right font-medium">Difference</th>
              <th className="p-3 font-medium">Follow-up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-line">
            {rows.map((record, index) => {
              const recordId = stringValue(record.id) || `${record.date}-${index}`;
              const subjectId = stringValue(record.subjectId);
              const name = kind === "account"
                ? accountIdMap.get(subjectId) || stringValue(record.subjectName) || "Account"
                : debtIdMap.get(subjectId) || stringValue(record.subjectName) || "Debt";
              const difference = numeric(record.difference);
              const debtChange = kind === "debt" ? debtHistory.changeById.get(recordId) : null;

              return (
                <tr key={recordId}>
                  <td className="p-3">
                    <span className="font-medium text-app-text">{name}</span>
                    <time className="mt-1 block text-app-muted" dateTime={stringValue(record.date)}>{stringValue(record.date)}</time>
                  </td>
                  <td className="p-3 text-right tabular-nums">{rupees(numeric(record.reported))}</td>
                  {kind === "debt" && (
                    <td className={`p-3 text-right tabular-nums ${debtChange != null && debtChange > 0.005 ? "text-app-gold" : "text-app-green"}`}>
                      {debtChange == null ? "First record" : signedRupees(debtChange)}
                    </td>
                  )}
                  <td className="p-3 text-right tabular-nums">{rupees(numeric(record.calculated))}</td>
                  <td className={`p-3 text-right tabular-nums ${Math.abs(difference) > 0.005 ? "text-app-gold" : "text-app-green"}`}>
                    {signedRupees(difference)}
                  </td>
                  <td className="min-w-52 p-3">
                    <select
                      aria-label={`Follow-up status for ${name}`}
                      className={`${INPUT_CLASS} py-2`}
                      onChange={(event) => updateFollowup(recordId, "followupStatus", event.target.value)}
                      value={stringValue(record.followupStatus) || "open"}
                    >
                      <option value="open">Open</option>
                      <option value="checking">Checking</option>
                      <option value="resolved">Resolved</option>
                    </select>
                    <input
                      aria-label={`Follow-up note for ${name}`}
                      className={`${INPUT_CLASS} mt-2 py-2`}
                      defaultValue={stringValue(record.followupNote)}
                      maxLength={160}
                      onBlur={(event) => {
                        if (event.target.value !== stringValue(record.followupNote)) {
                          updateFollowup(recordId, "followupNote", event.target.value);
                        }
                      }}
                      placeholder="Optional note"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="rounded-panel border border-app-line bg-app-panel p-5 shadow-glow sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Bank accounts, cash &amp; card</h2>
          <p className="mt-1 text-sm text-app-muted">Balances update from transactions; reconciliation adds a dated adjustment without deleting history.</p>
        </div>
        <button
          className="rounded-xl border border-app-line px-4 py-2.5 text-sm font-semibold hover:border-app-green disabled:cursor-not-allowed disabled:opacity-50"
          disabled={accounts.some((account) => account.kind === "cash")}
          onClick={addCashAccount}
          type="button"
        >
          + Add cash account
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => {
          const balance = accountBalances.get(account.id) || 0;
          const isCard = account.kind === "card";
          const isNegative = !isCard && balance < -0.005;
          const label = isNegative
            ? "Negative balance · spending exceeds available funds"
            : isCard
              ? "Card · debt balance"
              : account.kind === "cash"
                ? "Cash · included in liquid"
                : "Bank · included in liquid";

          return (
            <article className="rounded-xl border border-app-line bg-app-bg/60 p-4" key={account.id}>
              <p className="truncate text-sm font-semibold">{stringValue(account.name) || "Unnamed account"}</p>
              <p className={`mt-3 break-words text-2xl font-semibold tabular-nums ${isNegative ? "text-app-red" : "text-app-text"}`}>
                {balance < 0 ? `−${rupees(Math.abs(balance))}` : rupees(balance)}
              </p>
              <p className={`mt-1 text-xs ${isNegative ? "text-app-red" : "text-app-muted"}`}>{label}</p>
              <div className="mt-4 border-t border-app-line pt-3">
                <label className={LABEL_CLASS}>
                  Set actual balance (₹)
                  <div className="mt-1.5 flex gap-2">
                    <input
                      aria-label={`${stringValue(account.name)} actual balance`}
                      className={`${INPUT_CLASS} min-w-0`}
                      onChange={(event) => setActualValues((current) => ({
                        ...current,
                        [account.id]: event.target.value
                      }))}
                      step="0.01"
                      type="number"
                      value={actualValues[account.id] ?? String(balance)}
                    />
                    <button
                      className="shrink-0 rounded-xl border border-app-line px-3 text-xs font-semibold text-app-text hover:border-app-green"
                      onClick={() => reconcileActualBalance(account)}
                      type="button"
                    >
                      Update
                    </button>
                  </div>
                </label>
              </div>
            </article>
          );
        })}
      </div>

      <section className="mt-7 border-t border-app-line pt-6">
        <div className="mb-4">
          <h3 className="font-semibold">Statement reconciliation</h3>
          <p className="mt-1 text-xs text-app-muted">
            Compare bank/card or lender statements to the ledger. Comparisons do not change balances.
          </p>
        </div>
        <div className="grid gap-4 rounded-xl border border-app-line bg-app-bg/40 p-4 lg:grid-cols-2">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveStatement("account");
            }}
          >
            <h4 className="text-sm font-semibold sm:col-span-2">Bank or card statement</h4>
            <label className={LABEL_CLASS}>
              Account
              <select className={`${INPUT_CLASS} mt-1.5`} onChange={(event) => setAccountSelection(event.target.value)} required value={accountSelection}>
                <option value="">Choose an account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{stringValue(account.name) || "Unnamed account"}</option>)}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Statement date
              <input className={`${INPUT_CLASS} mt-1.5`} max={today()} onChange={(event) => setAccountStatementDate(event.target.value)} required type="date" value={accountStatementDate} />
            </label>
            <label className={LABEL_CLASS}>
              Statement balance (₹)
              <input className={`${INPUT_CLASS} mt-1.5`} onChange={(event) => setAccountReported(event.target.value)} required step="0.01" type="number" value={accountReported} />
            </label>
            <button className="self-end rounded-xl bg-app-green px-4 py-2.5 text-sm font-semibold text-app-bg hover:brightness-105" type="submit">
              Compare &amp; save
            </button>
          </form>

          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveStatement("debt");
            }}
          >
            <h4 className="text-sm font-semibold sm:col-span-2">Lender balance check</h4>
            <label className={LABEL_CLASS}>
              Debt / lender
              <select className={`${INPUT_CLASS} mt-1.5`} onChange={(event) => setDebtSelection(event.target.value)} required value={debtSelection}>
                <option value="">Choose a debt</option>
                {debts.map((debt) => <option key={debt.id} value={debt.id}>{stringValue(debt.name) || "Unnamed debt"}</option>)}
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Statement date
              <input className={`${INPUT_CLASS} mt-1.5`} max={today()} onChange={(event) => setDebtStatementDate(event.target.value)} required type="date" value={debtStatementDate} />
            </label>
            <label className={LABEL_CLASS}>
              Lender-reported balance (₹)
              <input className={`${INPUT_CLASS} mt-1.5`} min="0" onChange={(event) => setDebtReported(event.target.value)} required step="0.01" type="number" value={debtReported} />
            </label>
            <button className="self-end rounded-xl border border-app-line px-4 py-2.5 text-sm font-semibold hover:border-app-green" type="submit">
              Compare &amp; save
            </button>
          </form>
        </div>

        {message && (
          <p aria-live="polite" className={`mt-3 text-sm ${messageIsError ? "text-app-red" : "text-app-green"}`}>
            {message}
          </p>
        )}

        <div className="mt-6">
          <h4 className="mb-3 text-sm font-semibold">Account statements · latest 8</h4>
          {renderReconciliationRows(accountHistory, "account")}
        </div>
        <div className="mt-6">
          <h4 className="mb-3 text-sm font-semibold">Lender statements · latest 8</h4>
          {renderReconciliationRows(debtHistory.records, "debt")}
        </div>
      </section>
    </section>
  );
}
