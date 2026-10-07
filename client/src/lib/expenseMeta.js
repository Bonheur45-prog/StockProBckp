// Shared constants for expenses — must stay in sync with server/src/models/Expense.js.
export const EXPENSE_PAYMENT_METHODS = ["cash", "mobile_money", "card", "bank_transfer"];
export const EXPENSE_FREQUENCIES = ["monthly", "weekly"];

export const PAYMENT_METHOD_LABELS = {
  cash: "Cash",
  mobile_money: "Mobile money",
  card: "Card",
  bank_transfer: "Bank transfer",
};

export const FREQUENCY_LABELS = { monthly: "Monthly", weekly: "Weekly" };