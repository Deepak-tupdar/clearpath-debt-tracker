import { useRef, useState, type ChangeEvent } from "react";
import type { LedgerState } from "../../hooks/useLedgerState";
import {
  assertLedgerBackup,
  today
} from "../../utils/ledgerLogic";

type Row = Record<string, unknown>;
type DataManagementProps = {
  ledger: LedgerState;
  recoveryBackups: unknown[];
  recoveryError: string | null;
  rawStoredData: string | null;
  isReadOnly: boolean;
  error: string | null;
  onSave: (update: LedgerState | ((current: LedgerState) => LedgerState)) => boolean;
  onReplace: (nextState: LedgerState) => boolean;
};

type EncryptedBackup = {
  format: "clearpath-encrypted-backup";
  version: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: 310000;
  cipher: "AES-256-GCM";
  salt: string;
  iv: string;
  data: string;
};

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transactionsCount(value: unknown): number {
  if (!isRecord(value) || !Array.isArray(value.transactions)) return 0;
  return value.transactions.length;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveBackupKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function downloadJson(contents: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DataManagement({
  ledger,
  recoveryBackups,
  recoveryError,
  rawStoredData,
  isReadOnly,
  error: storageError,
  onSave,
  onReplace
}: DataManagementProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  const lastBackup = typeof ledger.lastBackupAt === "string"
    ? new Date(ledger.lastBackupAt)
    : null;
  const daysSinceBackup = lastBackup && !Number.isNaN(lastBackup.getTime())
    ? Math.floor((Date.now() - lastBackup.getTime()) / 86_400_000)
    : null;

  function report(messageText: string, isError = false) {
    setMessage(messageText);
    setMessageIsError(isError);
  }

  function exportPlainBackup() {
    if (isReadOnly && rawStoredData !== null) {
      downloadJson(rawStoredData, `clearpath-original-data-${today()}.json`);
      report("Original stored data exported without changing it.");
      return;
    }
    if (isReadOnly) {
      report("Saved data could not be read, and no raw storage value is available to export.", true);
      return;
    }

    const savedAt = new Date().toISOString();
    const snapshot = { ...ledger, lastBackupAt: savedAt };
    downloadJson(JSON.stringify(snapshot, null, 2), `clearpath-backup-${today()}.json`);
    if (onSave((current) => ({ ...current, lastBackupAt: savedAt }))) {
      report("Backup download started. Check your downloads folder.");
    } else {
      report("The backup file was created, but the export date could not be saved to tracker settings.", true);
    }
  }

  async function exportEncryptedBackup() {
    if (password.length < 12) {
      report("Use a backup password with at least 12 characters.", true);
      return;
    }
    if (password !== passwordConfirmation) {
      report("The backup passwords do not match.", true);
      return;
    }
    if (!window.crypto?.subtle || !window.isSecureContext) {
      report("Encrypted backups need Web Crypto in a secure browser context. Use localhost or an HTTPS site.", true);
      return;
    }

    setBusy(true);
    try {
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const key = await deriveBackupKey(password, salt);
      const backupState = { ...ledger, lastBackupAt: new Date().toISOString() };
      const plaintext = new TextEncoder().encode(JSON.stringify(backupState));
      const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
      const encrypted: EncryptedBackup = {
        format: "clearpath-encrypted-backup",
        version: 1,
        kdf: "PBKDF2-SHA-256",
        iterations: 310000,
        cipher: "AES-256-GCM",
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(ciphertext))
      };
      downloadJson(JSON.stringify(encrypted, null, 2), `clearpath-encrypted-backup-${today()}.json`);
      setPassword("");
      setPasswordConfirmation("");
      if (onSave((current) => ({ ...current, lastBackupAt: backupState.lastBackupAt }))) {
        report("Encrypted backup download started. Keep the password safe; it cannot be recovered.");
      } else {
        report("The encrypted backup file was created, but the export date could not be saved.", true);
      }
    } catch (cause) {
      report(cause instanceof Error ? `Could not create encrypted backup: ${cause.message}` : "Could not create the encrypted backup.", true);
    } finally {
      setBusy(false);
    }
  }

  async function decryptBackup(value: Row): Promise<unknown> {
    if (value.format !== "clearpath-encrypted-backup" || value.version !== 1 ||
        value.kdf !== "PBKDF2-SHA-256" || value.iterations !== 310000 ||
        value.cipher !== "AES-256-GCM" || typeof value.salt !== "string" ||
        typeof value.iv !== "string" || typeof value.data !== "string") {
      throw new Error("Unsupported encrypted backup format.");
    }
    if (!window.crypto?.subtle || !window.isSecureContext) {
      throw new Error("Web Crypto is unavailable in this browser context.");
    }
    const importPassword = window.prompt("Enter the password used to encrypt this backup:");
    if (importPassword === null) throw new Error("Backup import cancelled.");
    const key = await deriveBackupKey(importPassword, base64ToBytes(value.salt));
    const plaintext = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(value.iv) },
      key,
      base64ToBytes(value.data)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      let imported: unknown = JSON.parse(await file.text());
      if (isRecord(imported) && imported.format === "clearpath-encrypted-backup") {
        imported = await decryptBackup(imported);
      }
      assertLedgerBackup(imported);

      const debts = imported.debts as unknown[];
      const accounts = imported.accounts as unknown[];
      const transactions = imported.transactions as unknown[];
      const commitments = imported.commitments as unknown[];
      const preview = [
        `Import preview: ${file.name}`,
        `${debts.length} debts · ${accounts.length} accounts · ${transactions.length} transactions · ${commitments.length} commitments`,
        `Current data: ${transactionsCount(ledger)} transactions · ${Array.isArray(ledger.debts) ? ledger.debts.length : 0} debts`,
        "",
        "Import replaces the current tracker. A recovery copy of the current data will be saved first. Continue?"
      ].join("\n");
      if (!window.confirm(preview)) return;
      if (!onReplace(imported)) {
        report("Import was not completed. The current data was not replaced; see the storage warning.", true);
        return;
      }
      report("Backup imported and saved. The previous tracker data is in recovery backups.");
      setPassword("");
      setPasswordConfirmation("");
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : "Unknown import error.";
      report(errorMessage === "Backup import cancelled."
        ? errorMessage
        : `Could not import this backup: ${errorMessage}`, true);
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  function restoreRecoveryBackup(backup: unknown) {
    if (!isRecord(backup) || !("data" in backup)) {
      report("This recovery copy contains only the original raw storage value. Export it before attempting manual recovery.", true);
      return;
    }
    try {
      assertLedgerBackup(backup.data);
      const savedAt = typeof backup.savedAt === "string"
        ? new Date(backup.savedAt).toLocaleString("en-IN")
        : "an unknown date";
      if (!window.confirm(`Restore the recovery copy from ${savedAt}? Current data will be copied to recovery first.`)) return;
      if (!onReplace(backup.data)) {
        report("Recovery restore was not completed. The current data was not replaced.", true);
        return;
      }
      report("Recovery copy restored.");
    } catch (cause) {
      report(cause instanceof Error ? cause.message : "Could not restore this recovery copy.", true);
    }
  }

  function exportRecoveryRaw(backup: unknown, index: number) {
    if (!isRecord(backup) || typeof backup.raw !== "string") return;
    downloadJson(backup.raw, `clearpath-recovery-original-${index + 1}-${today()}.json`);
    report("Raw recovery data exported without attempting to parse or alter it.");
  }

  return (
    <section className="rounded-panel border border-app-line bg-app-panel p-5 shadow-glow sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Backup &amp; storage</h2>
          <p className="mt-1 text-sm text-app-muted">
            Data stays in this browser. Backups download to your device; they are not automatic.
          </p>
        </div>
        <button
          className="rounded-xl bg-app-green px-4 py-2.5 text-sm font-semibold text-app-bg hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
          disabled={busy || isReadOnly && rawStoredData === null}
          onClick={exportPlainBackup}
          type="button"
        >
          {isReadOnly ? "Export original stored data" : "Export backup now"}
        </button>
      </div>

      <p className={`mb-4 rounded-xl border px-4 py-3 text-sm ${daysSinceBackup == null || daysSinceBackup >= 14 ? "border-app-gold/30 bg-app-gold/5 text-app-gold" : "border-app-green/30 bg-app-green-dark/30 text-app-green"}`}>
        {isReadOnly
          ? "Saved data is read-only until it can be recovered. Export the original data before attempting replacement."
          : lastBackup && !Number.isNaN(lastBackup.getTime())
            ? `Last export recorded ${lastBackup.toLocaleString("en-IN")}.${daysSinceBackup != null && daysSinceBackup >= 14 ? " Consider saving a fresh backup." : ""}`
            : "No backup export recorded. Export one to protect your records outside this browser."}
      </p>

      {storageError && (
        <p className="mb-4 rounded-xl border border-app-red/30 bg-app-red/5 px-4 py-3 text-sm text-app-red" role="alert">
          {storageError}
        </p>
      )}

      <div className="grid gap-3 rounded-xl border border-app-line bg-app-bg/40 p-4 sm:grid-cols-2">
        <label className="block text-xs font-medium text-app-muted">
          Backup password
          <input
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green"
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Use 12+ characters"
            type="password"
            value={password}
          />
        </label>
        <label className="block text-xs font-medium text-app-muted">
          Confirm password
          <input
            autoComplete="new-password"
            className="mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-green"
            minLength={12}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            placeholder="Re-enter the password"
            type="password"
            value={passwordConfirmation}
          />
        </label>
        <button
          className="rounded-xl border border-app-line px-4 py-2.5 text-sm font-semibold text-app-text hover:border-app-green disabled:cursor-wait disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
          disabled={busy || isReadOnly}
          onClick={exportEncryptedBackup}
          type="button"
        >
          {busy ? "Working..." : "Export encrypted backup"}
        </button>
        <p className="text-xs leading-relaxed text-app-muted sm:col-span-2">
          Encrypted backups use PBKDF2-SHA-256 and AES-256-GCM. The password is not stored and cannot be recovered if lost.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="rounded-xl border border-app-line px-4 py-2.5 text-sm font-semibold hover:border-app-green"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          Import backup
        </button>
        <input
          accept="application/json,.json"
          className="hidden"
          onChange={importBackup}
          ref={fileInputRef}
          type="file"
        />
        <p className="text-xs text-app-muted">
          Imports are validated before replacing data, and the previous ledger is copied to recovery first.
        </p>
      </div>

      {(message || recoveryError) && (
        <div aria-live="polite" className={`mt-4 rounded-xl border px-4 py-3 text-sm ${messageIsError || recoveryError ? "border-app-red/30 bg-app-red/5 text-app-red" : "border-app-green/30 bg-app-green-dark/20 text-app-green"}`}>
          {recoveryError || message}
        </div>
      )}

      <div className="mt-6 border-t border-app-line pt-5">
        <div className="mb-3">
          <h3 className="font-semibold">Recovery backups before imports</h3>
          <p className="mt-1 text-xs text-app-muted">Stored on this device · newest 3</p>
        </div>
        {recoveryBackups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-app-line px-4 py-5 text-sm text-app-muted">
            No recovery copies found. A copy is saved here before each import.
          </p>
        ) : (
          <div className="space-y-2">
            {recoveryBackups.map((backup, index) => {
              const savedAt = isRecord(backup) && typeof backup.savedAt === "string"
                ? new Date(backup.savedAt)
                : null;
              const label = savedAt && !Number.isNaN(savedAt.getTime())
                ? savedAt.toLocaleString("en-IN")
                : "Unknown date";
              const hasData = isRecord(backup) && isRecord(backup.data);
              const hasRaw = isRecord(backup) && typeof backup.raw === "string";

              return (
                <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-line p-4" key={`${label}-${index}`}>
                  <div>
                    <h4 className="text-sm font-medium">Recovery copy {index + 1}</h4>
                    <p className="mt-1 text-xs text-app-muted">
                      {label} · {hasData ? `${transactionsCount(backup.data)} transactions` : hasRaw ? "original raw data" : "unrecognized copy"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {hasRaw && (
                      <button className="rounded-lg border border-app-line px-3 py-2 text-xs font-semibold hover:border-app-green" onClick={() => exportRecoveryRaw(backup, index)} type="button">
                        Export raw
                      </button>
                    )}
                    {hasData && (
                      <button className="rounded-lg border border-app-line px-3 py-2 text-xs font-semibold hover:border-app-green" onClick={() => restoreRecoveryBackup(backup)} type="button">
                        Restore
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
