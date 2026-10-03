import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LedgerState } from "../../hooks/useLedgerState";
import {
  borrowedBalances,
  isPosted,
  monthKey,
  paise,
  roundMoney,
  synchronizeDebtBalances,
  sumMoney,
  today,
  validDate,
  type LedgerAdjustment,
  type LedgerTransaction
} from "../../utils/ledgerLogic";

type RecordValue = Record<string, unknown>;
type IdRecord = RecordValue & { id: string };
type AccountRecord = IdRecord & { kind: string };
type TransactionFormProps = {
  ledger: LedgerState;
  onSave: (update: LedgerState | ((current: LedgerState) => LedgerState)) => boolean;
  editingTransaction?: LedgerTransaction | null;
  onCancelEdit?: () => void;
  onSaved?: () => void;
};

type FormValues = {
  date: string;
  type: string;
  amount: string;
  accountId: string;
  category: string;
  status: "posted" | "planned";
  billingMonth: string;
  note: string;
  person: string;
  useHeldFunds: boolean;
  heldFundsPerson: string;
  heldFundsAmount: string;
  debtId: string;
  commitmentId: string;
  cardId: string;
  transferToId: string;
  workHours: string;
  workKm: string;
  principalReduction: string;
  interest: string;
  fees: string;
  heldTransferPerson: string;
  heldTransferAmount: string;
  heldOutPerson: string;
};

const DEFAULTS: FormValues = {
  date: today(),
  type: "rapido",
  amount: "",
  accountId: "",
  category: "other",
  status: "posted",
  billingMonth: monthKey(today()),
  note: "",
  person: "",
  useHeldFunds: false,
  heldFundsPerson: "",
  heldFundsAmount: "",
  debtId: "",
  commitmentId: "",
  cardId: "",
  transferToId: "",
  workHours: "",
  workKm: "",
  principalReduction: "",
  interest: "",
  fees: "",
  heldTransferPerson: "",
  heldTransferAmount: "",
  heldOutPerson: ""
};

const CATEGORIES = [
  ["food", "Food & groceries"],
  ["transport", "Transport"],
  ["rapido", "Rapido operating costs"],
  ["bills", "Bills"],
  ["medical", "Medical"],
  ["personal", "Personal"],
  ["other", "Other"]
];

const INPUT_CLASS =
  "mt-1.5 w-full rounded-xl border border-app-line bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none transition placeholder:text-app-muted/60 focus:border-app-green";
const LABEL_CLASS = "block text-xs font-medium text-app-muted";

function records(value: unknown): RecordValue[] {
  return Array.isArray(value)
    ? value.filter((item): item is RecordValue =>
        typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function asTransactions(value: unknown): LedgerTransaction[] {
  return records(value).filter(
    (item): item is RecordValue & LedgerTransaction =>
      typeof item.date === "string" &&
      typeof item.type === "string" &&
      Number.isFinite(Number(item.amount))
  );
}

function asAdjustments(value: unknown): LedgerAdjustment[] {
  return records(value).filter(
    (item): item is RecordValue & LedgerAdjustment =>
      typeof item.kind === "string" &&
      typeof item.subjectId === "string" &&
      typeof item.date === "string" &&
      Number.isFinite(Number(item.amount))
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function makeId(): string {
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function initialValues(transaction?: LedgerTransaction | null): FormValues {
  if (!transaction) return { ...DEFAULTS, date: today(), billingMonth: monthKey(today()) };
  return {
    ...DEFAULTS,
    date: transaction.date,
    type: transaction.type,
    amount: String(transaction.amount),
    accountId: text(transaction.accountId),
    category: text(transaction.category) || "other",
    status: transaction.status === "planned" || transaction.date > today() ? "planned" : "posted",
    billingMonth: text(transaction.billingMonth) || monthKey(transaction.date),
    note: text(transaction.note),
    person: text(transaction.borrowedFrom || transaction.lendedTo || transaction.borrowRepaidTo || transaction.lendReturnedFrom || transaction.heldPerson),
    useHeldFunds: Boolean(transaction.heldFundsPerson),
    heldFundsPerson: text(transaction.heldFundsPerson),
    heldFundsAmount: transaction.heldFundsUsed == null ? "" : String(transaction.heldFundsUsed),
    debtId: text(transaction.debtId),
    commitmentId: text(transaction.commitmentId),
    cardId: text(transaction.cardAccountId),
    transferToId: text(transaction.transferToAccountId),
    workHours: transaction.workHours == null ? "" : String(transaction.workHours),
    workKm: transaction.workKm == null ? "" : String(transaction.workKm),
    principalReduction: transaction.debtPrincipalReduction == null ? "" : String(transaction.debtPrincipalReduction),
    interest: transaction.debtInterest == null ? "" : String(transaction.debtInterest),
    fees: transaction.debtFees == null ? "" : String(transaction.debtFees),
    heldTransferPerson: text(transaction.heldTransferPerson),
    heldTransferAmount: transaction.heldTransferAmount == null ? "" : String(transaction.heldTransferAmount),
    heldOutPerson: text(transaction.heldPerson)
  };
}

function eligibleAccount(type: string, kind: unknown): boolean {
  return kind !== "card" || ["expense", "commitment", "refund", "charge"].includes(type);
}

function heldBalanceFor(
  transactions: LedgerTransaction[],
  person: string,
  accountId: string,
  throughDate: string
): number {
  const target = person.trim().toLocaleLowerCase();
  const movements: number[] = [];
  for (const transaction of transactions.filter((item) => isPosted(item, throughDate))) {
    if (transaction.type === "heldIn" &&
        text(transaction.heldPerson).trim().toLocaleLowerCase() === target &&
        transaction.accountId === accountId) {
      movements.push(Number(transaction.amount));
    }
    if (transaction.type === "heldOut" &&
        text(transaction.heldPerson).trim().toLocaleLowerCase() === target &&
        transaction.accountId === accountId) {
      movements.push(-Number(transaction.amount));
    }
    if (transaction.type === "transfer" &&
        text(transaction.heldTransferPerson).trim().toLocaleLowerCase() === target) {
      const heldAmount = Number(transaction.heldTransferAmount) || 0;
      if (transaction.transferFromAccountId === accountId) movements.push(-heldAmount);
      if (transaction.transferToAccountId === accountId) movements.push(heldAmount);
    }
  }
  return Math.max(0, sumMoney(movements));
}

function heldFundsAvailableFor(
  transactions: LedgerTransaction[],
  person: string,
  accountId: string,
  throughDate: string
): number {
  const key = person.trim().toLocaleLowerCase();
  const heldAmount = heldBalanceFor(transactions, person, accountId, throughDate);
  const usedAmount = sumMoney(
    transactions
      .filter((transaction) =>
        transaction.accountId === accountId &&
        text(transaction.heldFundsPerson).trim().toLocaleLowerCase() === key &&
        isPosted(transaction, throughDate)
      )
      .map((transaction) => Number(transaction.heldFundsUsed) || 0)
  );
  return Math.max(0, heldAmount - usedAmount);
}

function currentCardBalance(
  card: RecordValue,
  transactions: LedgerTransaction[],
  adjustments: RecordValue[],
  throughDate: string
): number {
  const openingDate = text(card.openingDate);
  const opening = !openingDate || openingDate <= throughDate ? Number(card.opening) || 0 : 0;
  const movements = transactions.filter((transaction) => isPosted(transaction, throughDate)).map((transaction) => {
    if (transaction.type === "cardPayment" && transaction.cardAccountId === card.id) {
      return -Number(transaction.amount);
    }
    if (transaction.accountId !== card.id) return 0;
    if (["expense", "commitment", "charge"].includes(transaction.type)) return Number(transaction.amount);
    if (transaction.type === "refund") return -Number(transaction.amount);
    return 0;
  });
  const adjustmentTotal = sumMoney(
    adjustments
      .filter((item) => item.kind === "account" && item.subjectId === card.id && String(item.date) <= throughDate)
      .map((item) => Number(item.amount) || 0)
  );
  return sumMoney([opening, ...movements, adjustmentTotal]);
}

function outstandingDebtBefore(
  debt: IdRecord,
  transactions: LedgerTransaction[],
  adjustments: RecordValue[],
  throughDate: string
): number {
  const debtTransactions = transactions.filter((transaction) => transaction.debtId === debt.id);
  const baseline = Number(
    debt.balanceBaseline ??
      (Number(debt.remaining) + sumMoney(debtTransactions.map((transaction) =>
        Math.max(0, Number(transaction.debtPrincipalReduction ?? transaction.amount) || 0)
      )))
  );
  const reductions = sumMoney(
    debtTransactions
      .filter((transaction) => isPosted(transaction, throughDate))
      .map((transaction) => Math.max(0, Number(transaction.debtPrincipalReduction ?? transaction.amount) || 0))
  );
  const adjustmentsTotal = sumMoney(
    adjustments
      .filter((item) => item.kind === "debt" && item.subjectId === debt.id && String(item.date) <= throughDate)
      .map((item) => Number(item.amount) || 0)
  );
  return Math.max(0, sumMoney([baseline, adjustmentsTotal, -reductions]));
}

export default function TransactionForm({
  ledger,
  onSave,
  editingTransaction = null,
  onCancelEdit,
  onSaved
}: TransactionFormProps) {
  const [values, setValues] = useState<FormValues>(() => initialValues(editingTransaction));
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const accounts = records(ledger.accounts).filter(
    (item): item is AccountRecord => typeof item.id === "string" && typeof item.kind === "string"
  );
  const debts = records(ledger.debts).filter(
    (item): item is IdRecord => typeof item.id === "string"
  );
  const commitments = records(ledger.commitments).filter(
    (item): item is IdRecord => typeof item.id === "string"
  );
  const transactions = asTransactions(ledger.transactions);
  const selectedAccount = accounts.find((account) => account.id === values.accountId);
  const bankAndCash = accounts.filter((account) => account.kind === "bank" || account.kind === "cash");
  const cards = accounts.filter((account) => account.kind === "card");
  const repaymentOptions = useMemo(
    () => borrowedBalances(transactions.filter((transaction) => transaction.id !== editingTransaction?.id), values.date)
      .filter((entry) => entry.balance > 0.005),
    [transactions, values.date, editingTransaction?.id]
  );
  const heldPeople = useMemo(() => {
    const people = transactions.flatMap((transaction) =>
      transaction.type === "heldIn" || transaction.type === "heldOut"
        ? [text(transaction.heldPerson)]
        : transaction.type === "transfer" && Number(transaction.heldTransferAmount) > 0
          ? [text(transaction.heldTransferPerson)]
          : []
    );
    return [...new Set(people.map((person) => person.trim()).filter(Boolean))];
  }, [transactions]);

  useEffect(() => {
    setValues(initialValues(editingTransaction));
    setMessage(null);
  }, [editingTransaction]);

  useEffect(() => {
    if (!accounts.some((account) => account.id === values.accountId) && accounts.length) {
      setValues((current) => ({ ...current, accountId: text(accounts[0].id) }));
    }
  }, [accounts, values.accountId]);

  function change<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      const heldEligibleTypes = ["expense", "commitment", "emi", "debt", "cardPayment", "charge"];
      if (key === "type" && typeof value === "string" && !heldEligibleTypes.includes(value)) {
        next.useHeldFunds = false;
      }
      if (key === "accountId" && typeof value === "string") {
        const selected = accounts.find((account) => account.id === value);
        if (selected?.kind !== "bank" && selected?.kind !== "cash") next.useHeldFunds = false;
      }
      return next;
    });
    setMessage(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = roundMoney(Number(values.amount));
    if (!validDate(values.date) || !Number.isFinite(amount) || amount <= 0 ||
        !Number.isSafeInteger(paise(amount))) {
      setMessage("Enter a valid date and an amount greater than zero.");
      setMessageIsError(true);
      return;
    }
    if (values.status === "posted" && values.date > today()) {
      setMessage("Use Planned for a future transaction.");
      setMessageIsError(true);
      return;
    }
    const account = accounts.find((item) => item.id === values.accountId);
    if (!account || !eligibleAccount(values.type, account.kind)) {
      setMessage("Choose an eligible account for this transaction.");
      setMessageIsError(true);
      return;
    }

    const withoutEdited = transactions.filter((item) => item.id !== editingTransaction?.id);
    const transaction: LedgerTransaction = {
      ...(editingTransaction || {}),
      id: editingTransaction?.id || makeId(),
      date: values.date,
      type: values.type,
      amount,
      accountId: values.accountId,
      note: values.note.trim(),
      status: values.status,
      created: editingTransaction?.created || Date.now(),
      updatedAt: Date.now()
    };
    const billingMonth = values.billingMonth || monthKey(values.date);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
      setMessage("Choose a valid payment month.");
      setMessageIsError(true);
      return;
    }
    if (["emi", "commitment", "cardPayment", "salary"].includes(values.type)) {
      transaction.billingMonth = billingMonth;
    } else {
      delete transaction.billingMonth;
    }

    if (values.type === "rapido") {
      const workHours = values.workHours === "" ? 0 : Number(values.workHours);
      const workKm = values.workKm === "" ? 0 : Number(values.workKm);
      if (![workHours, workKm].every((value) => Number.isFinite(value) && value >= 0)) {
        setMessage("Enter valid Rapido hours and kilometres.");
        setMessageIsError(true);
        return;
      }
      transaction.workHours = workHours;
      transaction.workKm = workKm;
    } else {
      delete transaction.workHours;
      delete transaction.workKm;
    }

    if (["expense", "refund", "charge"].includes(values.type)) {
      transaction.category = values.category;
    } else {
      delete transaction.category;
    }

    if (values.type === "lended") {
      const lender = values.person.trim();
      if (!lender || !bankAndCash.some((item) => item.id === account.id)) {
        setMessage("Enter who lent you the money and select a bank or cash account.");
        setMessageIsError(true);
        return;
      }
      transaction.borrowedFrom = lender;
      delete transaction.borrowRepaidTo;
      delete transaction.lendedTo;
      delete transaction.lendReturnedFrom;
    } else if (values.type === "lendReturn") {
      const lender = values.person.trim();
      const outstanding = repaymentOptions.find(
        (entry) => entry.person.toLocaleLowerCase() === lender.toLocaleLowerCase()
      )?.balance || 0;
      if (!lender || !bankAndCash.some((item) => item.id === account.id)) {
        setMessage("Choose the lender you are repaying and use a bank or cash account.");
        setMessageIsError(true);
        return;
      }
      if (values.status !== "planned" && amount > outstanding + 0.005) {
        setMessage(`You owe ${lender} only ${outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })} as of this date.`);
        setMessageIsError(true);
        return;
      }
      transaction.borrowRepaidTo = lender;
      delete transaction.borrowedFrom;
      delete transaction.lendedTo;
      delete transaction.lendReturnedFrom;
    } else {
      delete transaction.borrowedFrom;
      delete transaction.borrowRepaidTo;
      delete transaction.lendedTo;
      delete transaction.lendReturnedFrom;
    }

    if (values.type === "heldIn" || values.type === "heldOut") {
      const person = values.heldOutPerson.trim();
      if (!person || !bankAndCash.some((item) => item.id === account.id)) {
        setMessage("Enter the person's name and select a bank or cash account.");
        setMessageIsError(true);
        return;
      }
      if (values.type === "heldOut" && values.status !== "planned" &&
          amount > heldBalanceFor(withoutEdited, person, values.accountId, values.date) + 0.005) {
        setMessage(`There is not enough of ${person}'s held money in this account to return that amount.`);
        setMessageIsError(true);
        return;
      }
      transaction.heldPerson = person;
    } else {
      delete transaction.heldPerson;
    }

    if (values.type === "transfer") {
      const destination = accounts.find((item) => item.id === values.transferToId);
      const heldAmount = values.heldTransferAmount === "" ? 0 : Number(values.heldTransferAmount);
      if (!destination || !bankAndCash.some((item) => item.id === account.id) ||
          !bankAndCash.some((item) => item.id === destination.id) ||
          account.id === destination.id) {
        setMessage("Choose two different bank or cash accounts for this transfer.");
        setMessageIsError(true);
        return;
      }
      if (!Number.isFinite(heldAmount) || heldAmount < 0 || heldAmount > amount) {
        setMessage("Held money moved must be between zero and the transfer amount.");
        setMessageIsError(true);
        return;
      }
      transaction.transferFromAccountId = account.id;
      transaction.transferToAccountId = destination.id;
      if (heldAmount > 0) {
        const heldPerson = values.heldTransferPerson.trim();
        if (!heldPerson || values.status !== "planned" &&
            heldAmount > heldBalanceFor(withoutEdited, heldPerson, account.id, values.date) + 0.005) {
          setMessage("Choose whose held funds are being transferred and check the available amount.");
          setMessageIsError(true);
          return;
        }
        transaction.heldTransferPerson = heldPerson;
        transaction.heldTransferAmount = heldAmount;
      } else {
        delete transaction.heldTransferPerson;
        delete transaction.heldTransferAmount;
      }
    } else {
      delete transaction.transferFromAccountId;
      delete transaction.transferToAccountId;
      delete transaction.heldTransferPerson;
      delete transaction.heldTransferAmount;
    }

    if (values.type === "cardPayment") {
      const card = cards.find((item) => item.id === values.cardId);
      if (!bankAndCash.some((item) => item.id === account.id) || !card) {
        setMessage("Select a bank or cash account and the credit card being paid.");
        setMessageIsError(true);
        return;
      }
      if (values.status !== "planned" &&
          amount > Math.max(0, currentCardBalance(card, withoutEdited, records(ledger.adjustments), values.date)) + 0.005) {
        setMessage("Payment cannot be more than this card's outstanding balance.");
        setMessageIsError(true);
        return;
      }
      transaction.cardAccountId = card.id;
    } else {
      delete transaction.cardAccountId;
    }

    if (values.type === "emi" || values.type === "debt") {
      const debt = debts.find((item) => item.id === values.debtId);
      if (!debt) {
        setMessage("Add or choose a debt before logging this payment.");
        setMessageIsError(true);
        return;
      }
      const principalInput = values.principalReduction.trim();
      const interest = values.interest === "" ? 0 : Number(values.interest);
      const fees = values.fees === "" ? 0 : Number(values.fees);
      const preserveLegacyAllocation = Boolean(
        editingTransaction &&
        editingTransaction.debtInterest == null &&
        editingTransaction.debtFees == null &&
        amount === Number(editingTransaction.amount) &&
        principalInput !== "" &&
        Number(principalInput) === Number(editingTransaction.debtPrincipalReduction ?? editingTransaction.amount) &&
        values.interest === "" &&
        values.fees === ""
      );
      const allocated = !preserveLegacyAllocation &&
        (principalInput !== "" || values.interest !== "" || values.fees !== "");
      const principal = principalInput === "" ? amount - interest - fees : Number(principalInput);
      if (![principal, interest, fees].every((value) => Number.isFinite(value) && value >= 0) ||
          principal > amount || Math.abs(principal + interest + fees - amount) > 0.005) {
        setMessage("Principal, interest, and fees must be non-negative and add up to the payment.");
        setMessageIsError(true);
        return;
      }
      if (!editingTransaction && debt.balanceBasis === "principal" &&
          (debt.apr == null || Number(debt.apr) > 0) && !allocated) {
        setMessage("Enter the principal, interest, and fees split for this loan payment.");
        setMessageIsError(true);
        return;
      }
      if (values.status !== "planned" &&
          principal > outstandingDebtBefore(debt, withoutEdited, records(ledger.adjustments), values.date) + 0.005) {
        setMessage("Principal reduction cannot exceed this debt's outstanding balance.");
        setMessageIsError(true);
        return;
      }
      transaction.debtId = String(debt.id);
      transaction.debtPrincipalReduction = principal;
      if (allocated) {
        transaction.debtInterest = interest;
        transaction.debtFees = fees;
      } else {
        delete transaction.debtInterest;
        delete transaction.debtFees;
      }
    } else {
      delete transaction.debtId;
      delete transaction.debtPrincipalReduction;
      delete transaction.debtInterest;
      delete transaction.debtFees;
    }

    if (values.type === "commitment") {
      const commitment = commitments.find((item) => item.id === values.commitmentId);
      if (!commitment) {
        setMessage("Add or choose a fixed commitment before logging this payment.");
        setMessageIsError(true);
        return;
      }
      transaction.commitmentId = String(commitment.id);
    } else {
      delete transaction.commitmentId;
    }

    if (values.useHeldFunds) {
      const allowedTypes = ["expense", "commitment", "emi", "debt", "cardPayment", "charge"];
      const heldAmount = Number(values.heldFundsAmount);
      const person = values.heldFundsPerson.trim();
      if (!allowedTypes.includes(values.type) || !bankAndCash.some((item) => item.id === account.id)) {
        setMessage("Held money can only be assigned to a payment from a bank or cash account.");
        setMessageIsError(true);
        return;
      }
      if (!person || !Number.isFinite(heldAmount) || heldAmount <= 0 || heldAmount > amount + 0.005) {
        setMessage("Choose whose held money you are using and enter an amount no greater than this payment.");
        setMessageIsError(true);
        return;
      }
      const available = heldFundsAvailableFor(withoutEdited, person, account.id, values.date);
      if (heldAmount > available + 0.005) {
        setMessage(`${person} has only ${available.toLocaleString("en-IN", { minimumFractionDigits: 2 })} of held funds available in this account.`);
        setMessageIsError(true);
        return;
      }
      transaction.heldFundsPerson = person;
      transaction.heldFundsUsed = roundMoney(heldAmount);
    } else {
      delete transaction.heldFundsPerson;
      delete transaction.heldFundsUsed;
    }

    const duplicate = withoutEdited.some((item) =>
      item.date === transaction.date &&
      item.type === transaction.type &&
      Number(item.amount) === amount &&
      item.accountId === transaction.accountId &&
      item.debtId === transaction.debtId &&
      item.commitmentId === transaction.commitmentId
    );
    if (duplicate && !window.confirm("A similar transaction is already recorded on this date. Save another one anyway?")) {
      return;
    }

    const saved = onSave((current) => {
      const existingRows = Array.isArray(current.transactions) ? current.transactions : [];
      const nextRows = [
        ...existingRows.filter((item) => item.id !== editingTransaction?.id),
        transaction
      ];
      return {
        ...current,
        debts: synchronizeDebtBalances(
          records(current.debts),
          asTransactions(existingRows),
          asTransactions(nextRows),
          asAdjustments(current.adjustments)
        ),
        transactions: nextRows
      };
    });
    if (!saved) return;

    setMessage(editingTransaction ? "Transaction updated." : "Transaction saved on this device.");
    setMessageIsError(false);
    onSaved?.();
    if (!editingTransaction) setValues({ ...DEFAULTS, date: today(), billingMonth: monthKey(today()) });
  }

  const hasDebtSelection = values.type === "emi" || values.type === "debt";
  const hasCategory = ["expense", "refund", "charge"].includes(values.type);
  const hasLender = values.type === "lended" || values.type === "lendReturn";
  const hasHeldPerson = values.type === "heldIn" || values.type === "heldOut";
  const canUseHeldFunds =
    ["expense", "commitment", "emi", "debt", "cardPayment", "charge"].includes(values.type) &&
    (selectedAccount?.kind === "bank" || selectedAccount?.kind === "cash");

  return (
    <section className="rounded-panel border border-app-line bg-app-panel p-5 shadow-glow sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">{editingTransaction ? "Edit transaction" : "Add transaction"}</h2>
        <p className="mt-1 text-sm text-app-muted">Choose what happened, then enter the amount and account.</p>
      </div>

      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className={LABEL_CLASS}>
          Date
          <input className={INPUT_CLASS} onChange={(event) => change("date", event.target.value)} required type="date" value={values.date} />
        </label>
        <label className={LABEL_CLASS}>
          What happened?
          <select className={INPUT_CLASS} onChange={(event) => change("type", event.target.value)} required value={values.type}>
            <optgroup label="Money in">
              <option value="rapido">Rapido earning</option>
              <option value="salary">Salary received</option>
              <option value="extra">Extra earning</option>
              <option value="refund">Refund received</option>
              <option value="lended">Borrowed from someone</option>
            </optgroup>
            <optgroup label="Money out">
              <option value="expense">Expense</option>
              <option value="commitment">Monthly commitment</option>
              <option value="emi">EMI payment</option>
              <option value="debt">Other debt payment</option>
              <option value="cardPayment">Credit card payment</option>
              <option value="lendReturn">Repay borrowed money</option>
              <option value="heldOut">Returned money I held</option>
              <option value="charge">Account interest / fee</option>
            </optgroup>
            <optgroup label="Move money">
              <option value="transfer">Transfer between my accounts</option>
              <option value="heldIn">Money held for someone</option>
            </optgroup>
          </select>
        </label>

        <label className={LABEL_CLASS}>
          Amount (₹)
          <input className={INPUT_CLASS} min="0.01" onChange={(event) => change("amount", event.target.value)} placeholder="e.g. 850" required step="0.01" type="number" value={values.amount} />
        </label>
        <label className={LABEL_CLASS}>
          Account
          <select className={INPUT_CLASS} onChange={(event) => change("accountId", event.target.value)} required value={values.accountId}>
            <option value="">Choose an account</option>
            {accounts.filter((item) => eligibleAccount(values.type, item.kind)).map((account) => (
              <option key={String(account.id)} value={String(account.id)}>{text(account.name) || "Unnamed account"}</option>
            ))}
          </select>
        </label>

        {hasCategory && (
          <label className={LABEL_CLASS}>
            Expense category
            <select className={INPUT_CLASS} onChange={(event) => change("category", event.target.value)} value={values.category}>
              {CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        )}

        {hasLender && (
          <label className={LABEL_CLASS}>
            {values.type === "lended" ? "Who lent you the money?" : "Who are you repaying?"}
            {values.type === "lendReturn" ? (
              <select className={INPUT_CLASS} onChange={(event) => change("person", event.target.value)} required value={values.person}>
                <option value="">Choose a lender</option>
                {repaymentOptions.map((entry) => (
                  <option key={entry.person} value={entry.person}>{entry.person} · owe ₹{entry.balance.toLocaleString("en-IN")}</option>
                ))}
              </select>
            ) : (
              <input autoComplete="off" className={INPUT_CLASS} maxLength={70} onChange={(event) => change("person", event.target.value)} placeholder="e.g. Rakesh" required value={values.person} />
            )}
          </label>
        )}

        {hasHeldPerson && (
          <label className={LABEL_CLASS}>
            Person whose money this is
            <input autoComplete="off" className={INPUT_CLASS} maxLength={70} onChange={(event) => change("heldOutPerson", event.target.value)} placeholder="Name" required value={values.heldOutPerson} />
          </label>
        )}

        {hasDebtSelection && (
          <label className={LABEL_CLASS}>
            Debt paid
            <select className={INPUT_CLASS} onChange={(event) => change("debtId", event.target.value)} required value={values.debtId}>
              <option value="">Choose a debt</option>
              {debts.map((debt) => <option key={String(debt.id)} value={String(debt.id)}>{text(debt.name) || "Unnamed debt"}</option>)}
            </select>
          </label>
        )}

        {values.type === "commitment" && (
          <label className={LABEL_CLASS}>
            Commitment paid
            <select className={INPUT_CLASS} onChange={(event) => change("commitmentId", event.target.value)} required value={values.commitmentId}>
              <option value="">Choose a commitment</option>
              {commitments.map((commitment) => <option key={String(commitment.id)} value={String(commitment.id)}>{text(commitment.name) || "Unnamed commitment"}</option>)}
            </select>
          </label>
        )}

        {values.type === "cardPayment" && (
          <label className={LABEL_CLASS}>
            Credit card paid
            <select className={INPUT_CLASS} onChange={(event) => change("cardId", event.target.value)} required value={values.cardId}>
              <option value="">Choose a credit card</option>
              {cards.map((card) => <option key={String(card.id)} value={String(card.id)}>{text(card.name) || "Unnamed card"}</option>)}
            </select>
          </label>
        )}

        {values.type === "transfer" && (
          <label className={LABEL_CLASS}>
            Transfer to
            <select className={INPUT_CLASS} onChange={(event) => change("transferToId", event.target.value)} required value={values.transferToId}>
              <option value="">Choose destination</option>
              {bankAndCash.filter((item) => item.id !== selectedAccount?.id).map((account) => (
                <option key={String(account.id)} value={String(account.id)}>{text(account.name) || "Unnamed account"}</option>
              ))}
            </select>
          </label>
        )}

        {values.type === "rapido" && (
          <>
            <label className={LABEL_CLASS}>
              Rapido hours (optional)
              <input className={INPUT_CLASS} min="0" onChange={(event) => change("workHours", event.target.value)} step="0.01" type="number" value={values.workHours} />
            </label>
            <label className={LABEL_CLASS}>
              Rapido kilometres (optional)
              <input className={INPUT_CLASS} min="0" onChange={(event) => change("workKm", event.target.value)} step="0.01" type="number" value={values.workKm} />
            </label>
          </>
        )}
        {canUseHeldFunds && (
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-xs text-app-muted">
              <input
                checked={values.useHeldFunds}
                className="mt-0.5 accent-app-green"
                onChange={(event) => change("useHeldFunds", event.target.checked)}
                type="checkbox"
              />
              Record part of this payment as using money held for someone
            </label>
            {values.useHeldFunds && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className={LABEL_CLASS}>
                  Person whose held money you are using
                  <select className={INPUT_CLASS} onChange={(event) => change("heldFundsPerson", event.target.value)} required value={values.heldFundsPerson}>
                    <option value="">Choose a person</option>
                    {heldPeople.filter((person) =>
                      heldFundsAvailableFor(transactions.filter((item) => item.id !== editingTransaction?.id), person, values.accountId, values.date) > 0.005
                    ).map((person) => (
                      <option key={person} value={person}>
                        {person} · {heldFundsAvailableFor(transactions.filter((item) => item.id !== editingTransaction?.id), person, values.accountId, values.date).toLocaleString("en-IN", { minimumFractionDigits: 2 })} available
                      </option>
                    ))}
                  </select>
                </label>
                <label className={LABEL_CLASS}>
                  Amount of their money used (₹)
                  <input className={INPUT_CLASS} min="0.01" onChange={(event) => change("heldFundsAmount", event.target.value)} required step="0.01" type="number" value={values.heldFundsAmount} />
                </label>
                <p className="text-xs leading-relaxed text-app-muted sm:col-span-2">
                  This does not reduce what you owe the person. Any account shortfall remains visible.
                </p>
              </div>
            )}
          </div>
        )}

        <details className="sm:col-span-2">
          <summary className="cursor-pointer py-2 text-sm font-medium text-app-green">
            More options (planned entry, payment month, notes)
          </summary>
          <div className="mt-3 grid gap-4 rounded-xl border border-app-line p-4 sm:grid-cols-2">
            <label className={LABEL_CLASS}>
              Status
              <select className={INPUT_CLASS} onChange={(event) => change("status", event.target.value as FormValues["status"])} value={values.status}>
                <option value="posted">Paid / received</option>
                <option value="planned">Planned / not yet</option>
              </select>
            </label>
            <label className={LABEL_CLASS}>
              Belongs to month
              <input className={INPUT_CLASS} onChange={(event) => change("billingMonth", event.target.value)} type="month" value={values.billingMonth} />
            </label>
            {values.type === "transfer" && (
              <>
                <label className={LABEL_CLASS}>
                  Held money transferred for (optional)
                  <input className={INPUT_CLASS} maxLength={70} onChange={(event) => change("heldTransferPerson", event.target.value)} value={values.heldTransferPerson} />
                </label>
                <label className={LABEL_CLASS}>
                  Held amount moved (₹)
                  <input className={INPUT_CLASS} min="0" onChange={(event) => change("heldTransferAmount", event.target.value)} step="0.01" type="number" value={values.heldTransferAmount} />
                </label>
              </>
            )}
            {hasDebtSelection && (
              <>
                <label className={LABEL_CLASS}>
                  Principal paid (optional)
                  <input className={INPUT_CLASS} min="0" onChange={(event) => change("principalReduction", event.target.value)} step="0.01" type="number" value={values.principalReduction} />
                </label>
                <label className={LABEL_CLASS}>
                  Interest paid (optional)
                  <input className={INPUT_CLASS} min="0" onChange={(event) => change("interest", event.target.value)} step="0.01" type="number" value={values.interest} />
                </label>
                <label className={LABEL_CLASS}>
                  Fees paid (optional)
                  <input className={INPUT_CLASS} min="0" onChange={(event) => change("fees", event.target.value)} step="0.01" type="number" value={values.fees} />
                </label>
              </>
            )}
            <label className="sm:col-span-2">
              <span className={LABEL_CLASS}>Note (optional)</span>
              <input className={INPUT_CLASS} maxLength={90} onChange={(event) => change("note", event.target.value)} placeholder="Short description" value={values.note} />
            </label>
          </div>
        </details>

        {message && (
          <p aria-live="polite" className={`sm:col-span-2 text-sm ${messageIsError ? "text-app-red" : "text-app-green"}`}>
            {message}
          </p>
        )}

        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {editingTransaction && (
            <button
              className="rounded-xl border border-app-line px-4 py-2.5 text-sm font-semibold text-app-text hover:border-app-muted"
              onClick={onCancelEdit}
              type="button"
            >
              Cancel edit
            </button>
          )}
          <button className="rounded-xl bg-app-green px-4 py-2.5 text-sm font-semibold text-app-bg hover:brightness-105" type="submit">
            {editingTransaction ? "Update transaction" : "Save transaction"}
          </button>
        </div>
      </form>

      <p className="mt-5 border-t border-app-line pt-4 text-xs leading-relaxed text-app-muted">
        Borrowing adds money to the selected account and records who you owe. Record money paid to someone else separately as an expense; it does not reduce that lender balance. Repaying borrowed money reduces your account and what you owe.
      </p>
    </section>
  );
}
