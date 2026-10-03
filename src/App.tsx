import { useState } from "react";
import { useLedgerState } from "./hooks/useLedgerState";
import type { LedgerTransaction } from "./utils/ledgerLogic";
import AccountList from "./components/Accounts/AccountList";
import CommitmentList from "./components/Commitments/CommitmentList";
import MetricsGrid from "./components/Dashboard/MetricsGrid";
import DebtList from "./components/Debts/DebtList";
import DataManagement from "./components/Settings/DataManagement";
import TransactionForm from "./components/Transactions/TransactionForm";
import TransactionList from "./components/Transactions/TransactionList";

export default function App() {
  const {
    ledger,
    updateLedger,
    replaceLedger,
    error,
    hasConflict,
    reloadLatest,
    recoveryBackups,
    recoveryError,
    rawStoredData,
    isReadOnly
  } = useLedgerState();
  const [editingTransaction, setEditingTransaction] = useState<LedgerTransaction | null>(null);

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 text-app-text sm:px-8">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-app-green text-xl font-black text-app-bg">
            C
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">Clearpath</p>
            <p className="text-sm text-app-muted">Debt and cash-flow tracker</p>
          </div>
        </div>
        <span className="rounded-full border border-app-green/40 px-3 py-2 text-xs font-medium text-app-green">
          Saved locally in this browser
        </span>
      </header>

      {(error || hasConflict) && (
        <section
          aria-live="polite"
          className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-app-gold/40 bg-app-panel p-4 text-sm"
        >
          <p className="text-app-gold">
            {hasConflict
              ? "Another tab has updated the tracker. Reload before making further changes."
              : error}
          </p>
          {hasConflict && (
            <button
              className="rounded-xl bg-app-green px-4 py-2 font-semibold text-app-bg"
              onClick={reloadLatest}
              type="button"
            >
              Reload latest data
            </button>
          )}
        </section>
      )}

      <section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-app-green">
            Financial overview
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Your money, in focus.</h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            Your existing tracker data is read directly from its original local storage key.
          </p>
        </div>
        <div className="rounded-2xl border border-app-line bg-app-panel px-5 py-4 shadow-glow">
          <p className="text-xs text-app-muted">Debt-free target</p>
          <p className="mt-1 font-semibold text-app-green">December 31, 2026</p>
        </div>
      </section>

      <MetricsGrid ledger={ledger} />

      <section className="mt-6">
        <DebtList ledger={ledger} onSave={updateLedger} />
      </section>

      <section className="mt-6">
        <CommitmentList ledger={ledger} onSave={updateLedger} />
      </section>

      <section className="mt-6">
        <AccountList ledger={ledger} onSave={updateLedger} />
      </section>

      <section className="mt-6">
        <TransactionForm
          editingTransaction={editingTransaction}
          ledger={ledger}
          onCancelEdit={() => setEditingTransaction(null)}
          onSave={updateLedger}
          onSaved={() => setEditingTransaction(null)}
        />
      </section>

      <section className="mt-6">
        <TransactionList
          ledger={ledger}
          onDeleted={(id) => {
            if (editingTransaction?.id === id) setEditingTransaction(null);
          }}
          onEdit={(transaction) => {
            setEditingTransaction(transaction);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onSave={updateLedger}
        />
      </section>

      <section className="mt-6">
        <DataManagement
          error={error}
          isReadOnly={isReadOnly}
          ledger={ledger}
          onReplace={replaceLedger}
          onSave={updateLedger}
          rawStoredData={rawStoredData}
          recoveryBackups={recoveryBackups}
          recoveryError={recoveryError}
        />
      </section>
    </main>
  );
}
