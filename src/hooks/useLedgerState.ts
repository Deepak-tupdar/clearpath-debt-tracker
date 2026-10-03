import { useCallback, useEffect, useRef, useState } from "react";

export const LEDGER_STORAGE_KEY = "clearpath-debt-tracker-v1";
export const RECOVERY_STORAGE_KEY = "clearpath-debt-tracker-recovery-v1";

export type LedgerState = {
  [key: string]: unknown;
  salary?: number;
  debts?: Array<Record<string, unknown>>;
  commitments?: Array<Record<string, unknown>>;
  accounts?: Array<Record<string, unknown>>;
  transactions?: Array<Record<string, unknown>>;
};

type StateUpdate = LedgerState | ((current: LedgerState) => LedgerState);

type LoadedLedger = {
  state: LedgerState;
  raw: string | null;
  error: string | null;
  recoveryBackups: unknown[];
  recoveryError: string | null;
};

const EMPTY_LEDGER: LedgerState = {
  salary: 20000,
  payday: null,
  debts: [],
  monthSnapshots: [],
  monthReviews: [],
  minimumCashBuffer: 0,
  forecastMonthlyExpenses: null,
  expenseLimits: {},
  statementReconciliations: [],
  reminderAdvanceDays: 7,
  commitments: [
    { id: "rakesh", name: "Rakesh loan", amount: 15000 },
    { id: "pg", name: "PG rent", amount: 10000 },
    { id: "home", name: "Home", amount: 5000 },
    { id: "fiance", name: "Fiance", amount: 10000 }
  ],
  accounts: [
    { id: "boi", name: "Bank of India", kind: "bank", opening: 0 },
    { id: "federal", name: "Federal Bank", kind: "bank", opening: 0 },
    { id: "sbi", name: "SBI", kind: "bank", opening: 0 },
    { id: "idfc", name: "IDFC First", kind: "bank", opening: 0 },
    { id: "roar", name: "Roar credit card", kind: "card", opening: 0 }
  ],
  transactions: []
};

function isLedgerState(value: unknown): value is LedgerState {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLedger(): LoadedLedger {
  let raw: string | null = null;
  const recovery = readRecoveryBackups();
  try {
    raw = window.localStorage.getItem(LEDGER_STORAGE_KEY);
    if (raw === null) {
      return {
        state: structuredClone(EMPTY_LEDGER),
        raw: null,
        error: null,
        recoveryBackups: recovery.backups,
        recoveryError: recovery.error
      };
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isLedgerState(parsed)) {
      throw new Error("The saved tracker data is not a JSON object. It has not been changed.");
    }

    // Return the stored object as-is. Do not merge defaults or rewrite legacy data on load.
    return {
      state: parsed,
      raw,
      error: null,
      recoveryBackups: recovery.backups,
      recoveryError: recovery.error
    };
  } catch (error) {
    return {
      state: structuredClone(EMPTY_LEDGER),
      raw,
      error: error instanceof Error ? error.message : "Could not read saved tracker data.",
      recoveryBackups: recovery.backups,
      recoveryError: recovery.error
    };
  }
}

function readRecoveryBackups(): { backups: unknown[]; error: string | null } {
  try {
    const raw = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (raw === null) return { backups: [], error: null };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { backups: [], error: "The saved recovery data is not a JSON array." };
    }
    return { backups: parsed, error: null };
  } catch (error) {
    return {
      backups: [],
      error: error instanceof Error ? error.message : "Could not read saved recovery data."
    };
  }
}

export function useLedgerState() {
  const initialRef = useRef<LoadedLedger | null>(null);
  if (initialRef.current === null) initialRef.current = readLedger();

  const [ledger, setLedger] = useState<LedgerState>(initialRef.current.state);
  const [error, setError] = useState<string | null>(initialRef.current.error);
  const [recoveryBackups, setRecoveryBackups] = useState<unknown[]>(initialRef.current.recoveryBackups);
  const [recoveryError, setRecoveryError] = useState<string | null>(initialRef.current.recoveryError);
  const [hasConflict, setHasConflict] = useState(false);
  const latestStateRef = useRef(ledger);
  const lastStoredRawRef = useRef(initialRef.current.raw);
  const writesBlockedRef = useRef(initialRef.current.error !== null);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LEDGER_STORAGE_KEY && event.newValue !== lastStoredRawRef.current) {
        setHasConflict(true);
      }
      if (event.key === RECOVERY_STORAGE_KEY) {
        const recovery = readRecoveryBackups();
        setRecoveryBackups(recovery.backups);
        setRecoveryError(recovery.error);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const updateLedger = useCallback((update: StateUpdate) => {
    if (writesBlockedRef.current) {
      setError("Saved data could not be read. The original data is protected from overwrite.");
      return false;
    }

    let currentRaw: string | null;
    try {
      currentRaw = window.localStorage.getItem(LEDGER_STORAGE_KEY);
    } catch (storageError) {
      setError(storageError instanceof Error ? storageError.message : "Could not verify saved tracker data.");
      return false;
    }
    if (currentRaw !== lastStoredRawRef.current || hasConflict) {
      setHasConflict(true);
      setError("Another tab changed the saved data. Reload the latest data before editing.");
      return false;
    }

    try {
      const nextState = typeof update === "function" ? update(latestStateRef.current) : update;
      if (!isLedgerState(nextState)) {
        setError("The update was not a valid tracker data object.");
        return false;
      }
      const nextRaw = JSON.stringify(nextState);
      window.localStorage.setItem(LEDGER_STORAGE_KEY, nextRaw);
      latestStateRef.current = nextState;
      lastStoredRawRef.current = nextRaw;
      setLedger(nextState);
      setError(null);
      return true;
    } catch (writeError) {
      setError(writeError instanceof Error ? writeError.message : "Could not save tracker data.");
      return false;
    }
  }, [hasConflict]);

  const reloadLatest = useCallback(() => {
    const latest = readLedger();
    latestStateRef.current = latest.state;
    lastStoredRawRef.current = latest.raw;
    writesBlockedRef.current = latest.error !== null;
    setLedger(latest.state);
    setError(latest.error);
    setRecoveryBackups(latest.recoveryBackups);
    setRecoveryError(latest.recoveryError);
    setHasConflict(false);
  }, []);

  const replaceLedger = useCallback((nextState: LedgerState) => {
    if (!isLedgerState(nextState)) {
      setError("The imported data was not a valid tracker object.");
      return false;
    }
    if (hasConflict) {
      setError("Another tab changed the saved data. Reload it before restoring a backup.");
      return false;
    }

    try {
      const currentRaw = window.localStorage.getItem(LEDGER_STORAGE_KEY);
      if (currentRaw !== lastStoredRawRef.current) {
        setHasConflict(true);
        setError("Another tab changed the saved data. Reload it before restoring a backup.");
        return false;
      }

      const currentBackup = writesBlockedRef.current
        ? { savedAt: new Date().toISOString(), raw: currentRaw, reason: error || "Unreadable original data" }
        : { savedAt: new Date().toISOString(), data: structuredClone(latestStateRef.current) };
      const recoveryRaw = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
      const parsedRecovery: unknown = recoveryRaw === null ? [] : JSON.parse(recoveryRaw);
      if (!Array.isArray(parsedRecovery)) {
        throw new Error("Existing recovery data is invalid. Export or repair it before replacing tracker data.");
      }
      const recoveryItems = parsedRecovery;
      const nextRecoveryRaw = JSON.stringify([currentBackup, ...recoveryItems].slice(0, 3));

      // Save the recovery copy first so the current ledger remains recoverable if the main write fails.
      window.localStorage.setItem(RECOVERY_STORAGE_KEY, nextRecoveryRaw);
      const nextRaw = JSON.stringify(nextState);
      window.localStorage.setItem(LEDGER_STORAGE_KEY, nextRaw);
      latestStateRef.current = nextState;
      lastStoredRawRef.current = nextRaw;
      writesBlockedRef.current = false;
      setLedger(nextState);
      setRecoveryBackups(JSON.parse(nextRecoveryRaw) as unknown[]);
      setRecoveryError(null);
      setError(null);
      setHasConflict(false);
      return true;
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : "Could not restore backup data.");
      return false;
    }
  }, [error, hasConflict]);

  return {
    ledger,
    updateLedger,
    replaceLedger,
    reloadLatest,
    error,
    hasConflict,
    recoveryBackups,
    recoveryError,
    rawStoredData: lastStoredRawRef.current,
    isReadOnly: writesBlockedRef.current
  };
}
