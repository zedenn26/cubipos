export type TaxMode = "inclusive" | "exclusive" | "exempt" | "zero-rated";

export type TaxResult = {
  net: number;
  tax: number;
  gross: number;
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateTax(price: number, rate: number, mode: TaxMode): TaxResult {
  if (mode === "exempt" || mode === "zero-rated") return { net: cents(price), tax: 0, gross: cents(price) };
  if (mode === "inclusive") {
    const net = cents(price / (1 + rate / 100));
    return { net, tax: cents(price - net), gross: cents(price) };
  }
  const tax = cents(price * rate / 100);
  return { net: cents(price), tax, gross: cents(price + tax) };
}

export function calculateCartTotal(items: Array<{ price: number; quantity: number; taxRate: number }>) {
  const subtotal = cents(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const tax = cents(items.reduce((sum, item) => sum + item.price * item.quantity * item.taxRate / 100, 0));
  return { subtotal, tax, total: cents(subtotal + tax) };
}

export function financialYearLabel(date: Date, startMonth = 3, startDay = 1) {
  const startThisYear = new Date(date.getFullYear(), startMonth, startDay);
  const startYear = date >= startThisYear ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}