import { describe, expect, it } from "vitest";
import { calculateCartTotal, calculateTax, financialYearLabel } from "./pos";

describe("POS domain calculations", () => {
  it("splits inclusive GST without floating point drift", () => {
    expect(calculateTax(118, 18, "inclusive")).toEqual({ net: 100, tax: 18, gross: 118 });
  });

  it("keeps exempt items tax-free", () => {
    expect(calculateTax(250, 18, "exempt").tax).toBe(0);
  });

  it("totals a mixed cart", () => {
    expect(calculateCartTotal([{ price: 100, quantity: 2, taxRate: 5 }, { price: 50, quantity: 1, taxRate: 18 }])).toEqual({ subtotal: 250, tax: 19, total: 269 });
  });

  it("labels Indian financial years from April", () => {
    expect(financialYearLabel(new Date("2026-03-31"))).toBe("2025-26");
    expect(financialYearLabel(new Date("2026-04-01"))).toBe("2026-27");
  });
});