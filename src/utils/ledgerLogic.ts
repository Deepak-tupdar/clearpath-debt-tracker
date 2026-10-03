export type LedgerTransaction = {
  id?: string;
  date: string;
  amount: number;
  type: string;
  status?: string;
  created?: number;
  debtId?: string;
  debtPrincipalReduction?: number;
  accountId?: string;
  transferFromAccountId?: string;
  transferToAccountId?: string;
  cardAccountId?: string;
  borrowedFrom?: string;
  borrowRepaidTo?: string;
  lendedTo?: string;
  lendReturnedFrom?: string;
  [key: string]: unknown;
};

export type DebtRecord = {
  id: string;
  remaining: number;
  balanceBaseline?: number;
  [key: string]: unknown;
};

export type LedgerAdjustment = {
  kind: string;
  subjectId: string;
  date: string;
  amount: number;
  [key: string]: unknown;
};

export type LedgerAccount = {
  id: string;
  kind: "bank" | "cash" | "card" | string;
  opening?: number;
  openingDate?: string;
  name?: string;
};

export type DashboardMetrics = {
  remainingDebt: number;
  debtCleared: number;
  totalDue: number;
  paidThisMonth: number;
  pendingThisMonth: number;
  targetToday: number;
  targetTomorrowIfMissed: number;
  liquid: number;
  held: number;
  ownLiquid: number;
  rapidoNet: number;
  rapidoGross: number;
  rapidoCosts: number;
  extraIncome: number;
  debtCount: number;
  deadlineDaysLeft: number;
};

type UnknownRecord = Record<string, unknown>;

export function paise(value: number | string | null | undefined): number {
  return Math.round((Number(value) || 0) * 100);
}

export function roundMoney(value: number): number {
  return paise(value) / 100;
}

export function sumMoney(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + paise(value), 0) / 100;
}

export function rupees(value: number | string | null | undefined): string {
  return `₹${(Number(value) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function today(): string {
  return dateString(new Date());
}

export function monthKey(date: string | Date): string {
  return typeof date === "string"
    ? date.slice(0, 7)
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isPosted(transaction: LedgerTransaction, throughDate = today()): boolean {
  return transaction.status !== "planned" && transaction.date <= throughDate;
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) &&
    dateString(parsed) === value &&
    value >= "1900-01-01" &&
    value <= "2200-12-31";
}

export function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && validDate(`${value}-01`);
}

export function assertLedgerBackup(value: unknown): asserts value is Record<string, unknown> {
  const fail = (reason: string): never => {
    throw new Error(`Invalid backup: ${reason}`);
  };
  if (!isRecord(value)) throw new Error("Invalid backup: expected a JSON object");
  const data = value;

  const collections = ["accounts", "debts", "commitments", "transactions"] as const;
  const ids = new Map<string, Set<string>>();
  for (const collection of collections) {
    const items = data[collection];
    if (!Array.isArray(items)) throw new Error(`Invalid backup: missing ${collection}`);
    const seen = new Set<string>();
    for (const item of items) {
      if (!isRecord(item)) throw new Error(`Invalid backup: invalid or duplicate ${collection} ID`);
      if (typeof item.id !== "string" || !item.id || seen.has(item.id)) {
        throw new Error(`Invalid backup: invalid or duplicate ${collection} ID`);
      }
      seen.add(item.id);
    }
    ids.set(collection, seen);
  }

  const number = (item: unknown, label: string, allowNegative = false) => {
    if (item == null || item === "" || !Number.isFinite(Number(item)) ||
        !Number.isSafeInteger(paise(Number(item))) ||
        !allowNegative && Number(item) < 0) fail(label);
  };
  const accounts = data.accounts as UnknownRecord[];
  const debts = data.debts as UnknownRecord[];
  const commitments = data.commitments as UnknownRecord[];
  const transactions = data.transactions as UnknownRecord[];
  const accountIds = ids.get("accounts")!;
  const debtIds = ids.get("debts")!;

  for (const account of accounts) {
    if (!["bank", "cash", "card"].includes(String(account.kind))) fail("account type");
    number(account.opening ?? 0, "account opening balance", true);
    if (account.openingDate && (typeof account.openingDate !== "string" || !validDate(account.openingDate))) {
      fail("account opening date");
    }
  }
  for (const debt of debts) {
    for (const key of ["remaining", "emi"]) number(debt[key] ?? 0, `debt ${key}`);
    for (const key of ["initial", "principal", "disbursed", "paidBeforeTracking",
      "principalPaidBefore", "balanceBaseline", "remainingEmis", "apr"]) {
      if (debt[key] != null) number(debt[key], `debt ${key}`);
    }
  }
  for (const commitment of commitments) number(commitment.amount, "commitment amount");

  const allowedTypes = new Set([
    "salary", "rapido", "extra", "expense", "commitment", "emi", "debt",
    "cardPayment", "transfer", "heldIn", "heldOut", "refund", "charge",
    "lended", "lendReturn"
  ]);
  for (const transaction of transactions) {
    if (typeof transaction.date !== "string" || !validDate(transaction.date)) fail("transaction date");
    number(transaction.amount, "transaction amount");
    if (!accountIds.has(String(transaction.accountId))) fail("transaction account reference");
    if (!allowedTypes.has(String(transaction.type))) fail("transaction type");
    if (transaction.status && !["posted", "planned"].includes(String(transaction.status))) fail("transaction status");
    if (transaction.billingMonth && (typeof transaction.billingMonth !== "string" || !validMonth(transaction.billingMonth))) {
      fail("payment month");
    }
    if (transaction.debtId && !debtIds.has(String(transaction.debtId))) fail("debt reference");
    for (const key of ["transferFromAccountId", "transferToAccountId", "cardAccountId"]) {
      if (transaction[key] && !accountIds.has(String(transaction[key]))) fail("account reference");
    }
    if (transaction.type === "transfer" &&
        (!transaction.transferFromAccountId || !transaction.transferToAccountId ||
          transaction.transferFromAccountId === transaction.transferToAccountId)) fail("transfer accounts");
    if (transaction.type === "cardPayment" && !transaction.cardAccountId) fail("card payment target");
    if (["emi", "debt"].includes(String(transaction.type)) && !transaction.debtId) fail("payment debt");
    for (const key of ["debtPrincipalReduction", "debtInterest", "debtFees",
      "heldTransferAmount", "workHours", "workKm", "heldFundsUsed"]) {
      if (transaction[key] != null) number(transaction[key], key);
    }
  }

  const optionalArrays = [
    "monthSnapshots", "monthReviews", "statementReconciliations", "adjustments",
    "cardStatements", "auditLog", "salaryHistory"
  ];
  for (const key of optionalArrays) {
    if (data[key] != null && !Array.isArray(data[key])) fail(key);
  }
  for (const adjustment of data.adjustments as UnknownRecord[] || []) {
    if (!["account", "debt"].includes(String(adjustment?.kind)) ||
        !((adjustment.kind === "account" ? accountIds : debtIds).has(String(adjustment.subjectId))) ||
        typeof adjustment.date !== "string" || !validDate(adjustment.date)) fail("adjustment");
    number(adjustment.amount, "adjustment amount", true);
  }
  const statementKeys = new Set<string>();
  for (const statement of data.cardStatements as UnknownRecord[] || []) {
    const key = `${statement?.cardId}|${statement?.month}`;
    if (!statement || !accountIds.has(String(statement.cardId)) ||
        typeof statement.month !== "string" || !validMonth(statement.month) ||
        typeof statement.dueDate !== "string" || !validDate(statement.dueDate) ||
        statementKeys.has(key)) fail("card statement");
    statementKeys.add(key);
    number(statement.amount, "statement amount");
    number(statement.minimum, "statement minimum");
    if (Number(statement.minimum) > Number(statement.amount)) fail("minimum exceeds statement");
  }

  for (const item of [...debts, ...commitments]) {
    for (const key of ["startMonth", "endMonth"]) {
      if (item[key] && (typeof item[key] !== "string" || !validMonth(item[key]))) fail(key);
    }
    if (item.scheduleHistory != null && !Array.isArray(item.scheduleHistory)) fail("schedule history");
    for (const row of item.scheduleHistory as UnknownRecord[] || []) {
      if (!row || typeof row.from !== "string" || !validMonth(row.from)) fail("schedule month");
      number(row.amount, "schedule amount");
      if (row.dueDay != null &&
          (!Number.isInteger(Number(row.dueDay)) || Number(row.dueDay) < 1 || Number(row.dueDay) > 31)) {
        fail("schedule due day");
      }
    }
  }
  for (const review of data.monthReviews as UnknownRecord[] || []) {
    if (!review || typeof review.month !== "string" || !validMonth(review.month) || !review.data) fail("month review");
  }
  for (const reconciliation of data.statementReconciliations as UnknownRecord[] || []) {
    if (!reconciliation || typeof reconciliation.id !== "string" ||
        typeof reconciliation.date !== "string" || !validDate(reconciliation.date)) fail("reconciliation");
  }
  if (data.deadline && (typeof data.deadline !== "string" || !validDate(data.deadline))) fail("deadline");
  if (data.trackingStartMonth &&
      (typeof data.trackingStartMonth !== "string" || !validMonth(data.trackingStartMonth))) fail("tracking start");
  for (const key of ["salary", "minimumCashBuffer", "forecastMonthlyExpenses"]) {
    if (data[key] != null) number(data[key], key);
  }
  if (data.expenseLimits != null && !isRecord(data.expenseLimits)) fail("expense limits");
  if (isRecord(data.expenseLimits)) {
    for (const limit of Object.values(data.expenseLimits)) number(limit, "expense limit");
  }
  for (const salary of data.salaryHistory as UnknownRecord[] || []) {
    if (!salary || typeof salary.from !== "string" || !validMonth(salary.from)) fail("salary period");
    number(salary.amount, "salary amount");
  }
  for (const audit of data.auditLog as UnknownRecord[] || []) {
    if (!audit || typeof audit.at !== "string" || !Array.isArray(audit.changes) ||
        audit.changes.some((change) => !isRecord(change))) fail("edit history");
  }
  if (data.payday != null &&
      (!Number.isInteger(Number(data.payday)) || Number(data.payday) < 1 || Number(data.payday) > 31)) {
    fail("payday");
  }
}

export function debtPrincipalReduction(transaction: LedgerTransaction): number {
  return Math.max(0, Number(transaction.debtPrincipalReduction ?? transaction.amount) || 0);
}

export function adjustmentSum(
  kind: string,
  subjectId: string,
  throughDate: string,
  adjustments: readonly LedgerAdjustment[]
): number {
  return sumMoney(
    adjustments
      .filter((item) => item.kind === kind && item.subjectId === subjectId && item.date <= throughDate)
      .map((item) => item.amount)
  );
}

export function debtBalanceAt(
  debt: DebtRecord,
  throughDate: string,
  transactions: readonly LedgerTransaction[],
  adjustments: readonly LedgerAdjustment[] = []
): number {
  const baseline = Number(
    debt.balanceBaseline ??
      (Number(debt.remaining) +
        sumMoney(
          transactions
            .filter((transaction) => transaction.debtId === debt.id)
            .map(debtPrincipalReduction)
        ))
  );
  const reductions = sumMoney(
    transactions
      .filter((transaction) => transaction.debtId === debt.id && isPosted(transaction, throughDate))
      .map(debtPrincipalReduction)
  );

  return Math.max(
    0,
    sumMoney([
      baseline,
      adjustmentSum("debt", debt.id, throughDate, adjustments),
      -reductions
    ])
  );
}

export function synchronizeDebtBalances(
  debts: readonly Record<string, unknown>[],
  baselineTransactions: readonly LedgerTransaction[],
  candidateTransactions: readonly LedgerTransaction[],
  adjustments: readonly LedgerAdjustment[] = [],
  throughDate = today()
): Array<Record<string, unknown>> {
  return debts.map((debt) => {
    if (typeof debt.id !== "string") return debt;

    const baseline = Number(
      debt.balanceBaseline ??
        (Number(debt.remaining) +
          sumMoney(
            baselineTransactions
              .filter((transaction) => transaction.debtId === debt.id)
              .map(debtPrincipalReduction)
          ))
    );
    const reductions = sumMoney(
      candidateTransactions
        .filter((transaction) =>
          transaction.debtId === debt.id && isPosted(transaction, throughDate)
        )
        .map(debtPrincipalReduction)
    );

    return {
      ...debt,
      balanceBaseline: baseline,
      remaining: Math.max(
        0,
        sumMoney([
          baseline,
          adjustmentSum("debt", debt.id, throughDate, adjustments),
          -reductions
        ])
      )
    };
  });
}

export function borrowedBalances(
  transactions: readonly LedgerTransaction[],
  throughDate = today()
): Array<{ person: string; borrowed: number; repaid: number; balance: number }> {
  const byLender = new Map<string, { person: string; borrowed: number; repaid: number }>();
  const ordered = [...transactions]
    .filter((transaction) => isPosted(transaction, throughDate))
    .sort((left, right) =>
      left.date.localeCompare(right.date) || (left.created || 0) - (right.created || 0)
    );

  for (const transaction of ordered) {
    if (transaction.type !== "lended" && transaction.type !== "lendReturn") continue;
    const person = String(
      transaction.borrowedFrom ||
        transaction.lendedTo ||
        transaction.borrowRepaidTo ||
        transaction.lendReturnedFrom ||
        "Unspecified lender"
    ).trim();
    const key = person.toLocaleLowerCase();
    const entry = byLender.get(key) || { person, borrowed: 0, repaid: 0 };

    if (transaction.type === "lended") {
      entry.borrowed = sumMoney([entry.borrowed, transaction.amount]);
    } else {
      entry.repaid = sumMoney([entry.repaid, transaction.amount]);
    }
    byLender.set(key, entry);
  }

  return [...byLender.values()]
    .map((entry) => ({
      ...entry,
      balance: sumMoney([entry.borrowed, -entry.repaid])
    }))
    .filter((entry) => entry.borrowed > 0.005 || entry.repaid > 0.005);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function validTransaction(value: UnknownRecord): value is UnknownRecord & LedgerTransaction {
  return typeof value.date === "string" &&
    typeof value.type === "string" &&
    Number.isFinite(Number(value.amount));
}

function validAccount(value: UnknownRecord): value is UnknownRecord & LedgerAccount {
  return typeof value.id === "string" &&
    typeof value.kind === "string" &&
    Number.isFinite(Number(value.opening ?? 0));
}

function numeric(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function sumAdjustments(
  kind: string,
  id: string,
  date: string,
  adjustments: UnknownRecord[]
): number {
  return sumMoney(
    adjustments
      .filter((item) => item.kind === kind && item.subjectId === id && String(item.date) <= date)
      .map((item) => numeric(item.amount))
  );
}

function accountMovement(account: LedgerAccount, transaction: LedgerTransaction): number {
  if (transaction.type === "transfer") {
    if (transaction.transferFromAccountId === account.id) return -numeric(transaction.amount);
    if (transaction.transferToAccountId === account.id) return numeric(transaction.amount);
    return 0;
  }
  if (account.kind === "card" && transaction.type === "cardPayment" &&
      transaction.cardAccountId === account.id) {
    return -numeric(transaction.amount);
  }
  if (transaction.accountId !== account.id) return 0;
  if (account.kind === "card") {
    if (["expense", "commitment", "charge"].includes(transaction.type)) return numeric(transaction.amount);
    if (transaction.type === "refund") return -numeric(transaction.amount);
    return 0;
  }
  return ["salary", "rapido", "extra", "heldIn", "refund", "lended"].includes(transaction.type)
    ? numeric(transaction.amount)
    : -numeric(transaction.amount);
}

export function accountBalanceAtDate(
  account: LedgerAccount,
  date: string,
  transactions: LedgerTransaction[],
  adjustments: UnknownRecord[]
): number {
  const opening = !account.openingDate || account.openingDate <= date
    ? numeric(account.opening)
    : 0;
  const movements = transactions
    .filter((transaction) => isPosted(transaction, date))
    .map((transaction) => accountMovement(account, transaction));
  return sumMoney([
    opening,
    ...movements,
    sumAdjustments("account", account.id, date, adjustments)
  ]);
}

function scheduleAt(item: UnknownRecord, month: string): UnknownRecord {
  const schedule = records(item.scheduleHistory)
    .filter((row) => typeof row.from === "string" && row.from <= month)
    .sort((left, right) => String(left.from).localeCompare(String(right.from)));
  return schedule.at(-1) || {
    amount: numeric(item.emi ?? item.amount),
    dueDay: item.dueDay
  };
}

function daysUntilDeadline(deadline: string, fromDate: string): number {
  if (!validDate(deadline) || !validDate(fromDate)) return 0;
  const start = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${deadline}T00:00:00`);
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

export function calculateDashboardMetrics(
  state: Record<string, unknown>,
  asOf = today()
): DashboardMetrics {
  const transactions = records(state.transactions).filter(validTransaction);
  const debts = records(state.debts);
  const commitments = records(state.commitments);
  const accounts = records(state.accounts).filter(validAccount);
  const adjustments = records(state.adjustments);
  const month = monthKey(asOf);
  const throughToday = transactions.filter((transaction) => isPosted(transaction, asOf));
  const cardAccounts = accounts.filter((account) => account.kind === "card");
  const borrowings = borrowedBalances(transactions, asOf);
  const cardBalance = (account: LedgerAccount) =>
    Math.max(0, accountBalanceAtDate(account, asOf, transactions, adjustments));
  const debtRemaining = debts.reduce((total, debt) => {
    const id = String(debt.id || "");
    if (!id) return total + Math.max(0, numeric(debt.remaining));
    return total + debtBalanceAt(
      debt as DebtRecord,
      asOf,
      transactions,
      adjustments as LedgerAdjustment[]
    );
  }, 0);
  const remainingDebt = sumMoney([
    debtRemaining,
    ...cardAccounts.map(cardBalance),
    ...borrowings.map((entry) => Math.max(0, entry.balance))
  ]);
  const debtCleared = sumMoney([
    ...debts.map((debt) =>
      numeric(debt.principalPaidBefore) +
      sumMoney(
        throughToday
          .filter((transaction) => transaction.debtId === debt.id)
          .map(debtPrincipalReduction)
      )
    ),
    ...throughToday
      .filter((transaction) => transaction.type === "cardPayment")
      .map((transaction) => numeric(transaction.amount)),
    ...borrowings.map((entry) => entry.repaid)
  ]);
  const monthTransactions = throughToday.filter((transaction) => monthKey(transaction.date) === month);
  const obligations: Array<{ due: number; paid: number }> = [];

  for (const [kind, items] of [["EMI", debts], ["Commitment", commitments]] as const) {
    for (const item of items) {
      if ((typeof item.startMonth === "string" && month < item.startMonth) ||
          (typeof item.endMonth === "string" && month > item.endMonth)) continue;

      const itemId = String(item.id || "");
      const payments = throughToday.filter((transaction) =>
        (transaction.billingMonth || monthKey(transaction.date)) === month &&
        (kind === "EMI"
          ? transaction.type === "emi" && transaction.debtId === itemId
          : transaction.type === "commitment" && transaction.commitmentId === itemId)
      );
      if (kind === "EMI" && itemId &&
          debtBalanceAt(item as DebtRecord, `${month}-01`, transactions, adjustments as LedgerAdjustment[]) <= 0.005 &&
          payments.length === 0) continue;

      obligations.push({
        due: Math.max(0, numeric(scheduleAt(item, month).amount)),
        paid: sumMoney(payments.map((transaction) => numeric(transaction.amount)))
      });
    }
  }

  for (const statement of records(state.cardStatements).filter((item) => item.month === month)) {
    const payments = throughToday.filter((transaction) =>
      transaction.type === "cardPayment" &&
      transaction.cardAccountId === statement.cardId &&
      (transaction.billingMonth || monthKey(transaction.date)) === month
    );
    obligations.push({
      due: Math.max(
        0,
        numeric(statement.mode === "minimum" ? statement.minimum : statement.amount)
      ),
      paid: sumMoney(payments.map((transaction) => numeric(transaction.amount)))
    });
  }

  const totalDue = sumMoney(obligations.map((item) => item.due));
  const paidThisMonth = sumMoney(
    obligations.map((item) => Math.min(item.due, item.paid))
  );
  const pendingThisMonth = sumMoney(
    obligations.map((item) => Math.max(0, item.due - item.paid))
  );
  const rapidoGross = sumMoney(
    monthTransactions
      .filter((transaction) => transaction.type === "rapido")
      .map((transaction) => numeric(transaction.amount))
  );
  const rapidoCosts = sumMoney(
    monthTransactions
      .filter((transaction) =>
        ["expense", "charge", "refund"].includes(transaction.type) &&
        transaction.category === "rapido"
      )
      .map((transaction) =>
        transaction.type === "refund" ? -numeric(transaction.amount) : numeric(transaction.amount)
      )
  );
  const rapidoNet = sumMoney([rapidoGross, -rapidoCosts]);
  const liquid = sumMoney(
    accounts
      .filter((account) => account.kind !== "card")
      .map((account) => accountBalanceAtDate(account, asOf, transactions, adjustments))
  );
  const held = new Map<string, Map<string, number>>();
  const addHeld = (person: unknown, accountId: unknown, amount: number) => {
    if (typeof person !== "string" || !person.trim() || typeof accountId !== "string") return;
    const key = person.trim().toLocaleLowerCase();
    const accountsHeld = held.get(key) || new Map<string, number>();
    accountsHeld.set(accountId, sumMoney([accountsHeld.get(accountId) || 0, amount]));
    held.set(key, accountsHeld);
  };
  for (const transaction of throughToday) {
    if (transaction.type === "heldIn") addHeld(transaction.heldPerson, transaction.accountId, numeric(transaction.amount));
    if (transaction.type === "heldOut") addHeld(transaction.heldPerson, transaction.accountId, -numeric(transaction.amount));
    if (transaction.type === "transfer" && numeric(transaction.heldTransferAmount) > 0) {
      addHeld(transaction.heldTransferPerson, transaction.transferFromAccountId, -numeric(transaction.heldTransferAmount));
      addHeld(transaction.heldTransferPerson, transaction.transferToAccountId, numeric(transaction.heldTransferAmount));
    }
  }
  const heldTotal = sumMoney(
    [...held.values()].flatMap((byAccount) =>
      [...byAccount.values()].map((amount) => Math.max(0, amount))
    )
  );
  const deadline = typeof state.deadline === "string" ? state.deadline : "2026-12-31";
  const deadlineDaysLeft = daysUntilDeadline(deadline, asOf);
  const targetToday = deadlineDaysLeft > 0 ? remainingDebt / deadlineDaysLeft : remainingDebt;
  const remainingDaysAfterToday = Math.max(0, deadlineDaysLeft - 1);
  const targetTomorrowIfMissed = remainingDaysAfterToday > 0
    ? remainingDebt / remainingDaysAfterToday
    : remainingDebt;

  return {
    remainingDebt,
    debtCleared,
    totalDue,
    paidThisMonth,
    pendingThisMonth,
    targetToday,
    targetTomorrowIfMissed,
    liquid,
    held: heldTotal,
    ownLiquid: sumMoney([liquid, -heldTotal]),
    rapidoNet,
    rapidoGross,
    rapidoCosts,
    extraIncome: sumMoney(
      monthTransactions
        .filter((transaction) => transaction.type === "extra")
        .map((transaction) => numeric(transaction.amount))
    ),
    debtCount: debts.length,
    deadlineDaysLeft
  };
}
