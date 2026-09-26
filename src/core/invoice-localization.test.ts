import { describe, expect, it } from "vitest";
import {
  amountInWords,
  buildEpcQrPayload,
  defaultCurrencyForRegion,
  defaultTaxIdLabelForRegion,
  invoiceTaxTotals,
  invoiceTotals,
  lineItemTaxAmount,
  numberToWordsEn,
  pageSizeForRegion,
  resolveInvoiceCurrency,
  resolveInvoiceQrPayload,
  resolveInvoiceTaxRegion,
  resolveSellerTaxIdLabel,
  taxLabelForRegion,
} from "@/core/invoice";
import { CURRENCIES, isKnownCurrency } from "@/core/currencies";
import type { Invoice, InvoiceLineItem } from "@/core/entities";

function line(partial: Partial<InvoiceLineItem> & { amount: number }): InvoiceLineItem {
  const { amount, ...rest } = partial;
  return {
    id: "li1",
    description: "work",
    quantity: 1,
    rate: amount,
    amount,
    ...rest,
  };
}

function invoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv1",
    clientId: "c1",
    invoiceNumber: "INV-1001",
    issueDate: 1,
    dueDate: 2,
    status: "draft",
    lineItems: [],
    subtotal: 0,
    total: 0,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("lineItemTaxAmount", () => {
  it("is zero without a tax rate", () => {
    expect(lineItemTaxAmount(line({ amount: 100 }))).toBe(0);
  });
  it("computes percent of amount, rounded to cents", () => {
    expect(lineItemTaxAmount(line({ amount: 100, taxRate: 8.5 }))).toBe(8.5);
    expect(lineItemTaxAmount(line({ amount: 10, taxRate: 8.333 }))).toBe(0.83);
  });
});

describe("invoiceTaxTotals", () => {
  it("keeps total === subtotal when no line has a tax rate (legacy)", () => {
    const t = invoiceTaxTotals([line({ amount: 100 }), line({ amount: 25 })]);
    expect(t.subtotal).toBe(125);
    expect(t.taxTotal).toBe(0);
    expect(t.total).toBe(125);
    expect(t.groups).toEqual([]);
  });
  it("groups tax by rate ascending and sums correctly", () => {
    const t = invoiceTaxTotals([
      line({ amount: 100, taxRate: 20 }),
      line({ amount: 200, taxRate: 10, taxLabel: "Reduced" }),
      line({ amount: 50, taxRate: 20 }),
    ]);
    expect(t.subtotal).toBe(350);
    expect(t.taxTotal).toBe(50);
    expect(t.total).toBe(400);
    expect(t.groups.map((g) => g.rate)).toEqual([10, 20]);
    expect(t.groups[0]).toMatchObject({ taxable: 200, tax: 20, label: "Reduced" });
    expect(t.groups[1]).toMatchObject({ taxable: 150, tax: 30, label: null });
  });
  it("keeps a uniform custom label, drops it when lines disagree", () => {
    const uniform = invoiceTaxTotals([
      line({ amount: 100, taxRate: 5, taxLabel: "City tax" }),
      line({ amount: 100, taxRate: 5, taxLabel: "City tax" }),
    ]);
    expect(uniform.groups[0].label).toBe("City tax");
    const mixed = invoiceTaxTotals([
      line({ amount: 100, taxRate: 5, taxLabel: "City tax" }),
      line({ amount: 100, taxRate: 5 }),
    ]);
    expect(mixed.groups[0].label).toBeNull();
  });
});

describe("invoiceTotals (backward compat)", () => {
  it("still returns subtotal/total and now includes tax", () => {
    expect(invoiceTotals([line({ amount: 100 })])).toEqual({
      subtotal: 100,
      total: 100,
    });
    expect(invoiceTotals([line({ amount: 100, taxRate: 10 })])).toEqual({
      subtotal: 100,
      total: 110,
    });
  });
});

describe("numberToWordsEn", () => {
  it("spells integers", () => {
    expect(numberToWordsEn(0)).toBe("zero");
    expect(numberToWordsEn(7)).toBe("seven");
    expect(numberToWordsEn(19)).toBe("nineteen");
    expect(numberToWordsEn(42)).toBe("forty-two");
    expect(numberToWordsEn(100)).toBe("one hundred");
    expect(numberToWordsEn(1234)).toBe("one thousand two hundred thirty-four");
    expect(numberToWordsEn(1_000_000)).toBe("one million");
    expect(numberToWordsEn(2_500_019)).toBe(
      "two million five hundred thousand nineteen",
    );
  });
});

describe("amountInWords", () => {
  it("spells USD amounts", () => {
    expect(amountInWords(1234.56)).toBe(
      "One thousand two hundred thirty-four dollars and fifty-six cents",
    );
    expect(amountInWords(1)).toBe("One dollar");
    expect(amountInWords(0.01)).toBe("One cent");
    expect(amountInWords(100)).toBe("One hundred dollars");
  });
  it("handles other currencies and edge cases", () => {
    expect(amountInWords(20, "EUR")).toBe("Twenty euros");
    expect(amountInWords(1.01, "GBP")).toBe("One pound and one penny");
    expect(amountInWords(2.5, "GBP")).toBe("Two pounds and fifty pence");
    expect(amountInWords(0)).toBe("Zero dollars");
    expect(amountInWords(-5)).toBe("Negative five dollars");
    expect(amountInWords(10, "ZZZ")).toBe("Ten ZZZ");
  });
});

describe("region helpers", () => {
  it("labels", () => {
    expect(taxLabelForRegion("US")).toBe("Sales tax");
    expect(taxLabelForRegion("EU")).toBe("VAT");
    expect(taxLabelForRegion(undefined)).toBe("Sales tax");
    expect(defaultTaxIdLabelForRegion("EU")).toBe("VAT ID");
    expect(defaultTaxIdLabelForRegion("US")).toBe("Tax ID");
  });
  it("page size and default currency", () => {
    expect(pageSizeForRegion("US")).toBe("LETTER");
    expect(pageSizeForRegion("EU")).toBe("A4");
    expect(defaultCurrencyForRegion("US")).toBe("USD");
    expect(defaultCurrencyForRegion("EU")).toBe("EUR");
  });
  it("resolves effective region/currency/label", () => {
    expect(resolveInvoiceTaxRegion(invoice(), "EU")).toBe("EU");
    expect(resolveInvoiceTaxRegion(invoice({ taxRegion: "US" }), "EU")).toBe("US");
    expect(resolveInvoiceCurrency(invoice(), undefined)).toBe("USD");
    expect(resolveInvoiceCurrency(invoice({ taxRegion: "EU" }), undefined)).toBe("EUR");
    expect(resolveInvoiceCurrency(invoice({ currency: "gbp" }), "USD")).toBe("GBP");
    expect(
      resolveSellerTaxIdLabel(invoice({ taxRegion: "EU" }), undefined),
    ).toBe("VAT ID");
    expect(
      resolveSellerTaxIdLabel(invoice({ sellerTaxIdLabel: "EIN" }), "VAT ID"),
    ).toBe("EIN");
  });
});

describe("buildEpcQrPayload", () => {
  it("builds a valid EPC/SEPA payload", () => {
    const payload = buildEpcQrPayload({
      beneficiaryName: "Acme Studio",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
      amountEur: 1234.5,
      remittance: "INV-1001",
    });
    const lines = payload.split("\n");
    expect(lines[0]).toBe("BCD");
    expect(lines[1]).toBe("002");
    expect(lines[3]).toBe("SCT");
    expect(lines[6]).toBe("DE89370400440532013000");
    expect(lines[7]).toBe("EUR1234.50");
    expect(lines[9]).toBe("INV-1001");
  });
  it("rejects bad IBAN and bad amounts", () => {
    expect(() =>
      buildEpcQrPayload({
        beneficiaryName: "x",
        iban: "nope",
        amountEur: 10,
      }),
    ).toThrow();
    expect(() =>
      buildEpcQrPayload({
        beneficiaryName: "x",
        iban: "DE89370400440532013000",
        amountEur: 0,
      }),
    ).toThrow();
  });
});

describe("resolveInvoiceQrPayload", () => {
  const base = invoice({ total: 110, qrEnabled: true });
  it("returns null when QR is disabled", () => {
    expect(resolveInvoiceQrPayload(invoice({ total: 10 }), { businessName: "B" })).toBeNull();
  });
  it("prefers an explicit payload", () => {
    expect(
      resolveInvoiceQrPayload(
        { ...base, qrPayload: "https://pay.example/x" },
        { businessName: "B" },
      ),
    ).toBe("https://pay.example/x");
  });
  it("builds an EPC payload for EU invoices with an IBAN", () => {
    const payload = resolveInvoiceQrPayload(
      {
        ...base,
        taxRegion: "EU",
        currency: "EUR",
        bankAccount: "DE89370400440532013000",
        swiftBic: "COBADEFFXXX",
      },
      { businessName: "Acme" },
    );
    expect(payload).toContain("BCD\n002\n1\nSCT");
    expect(payload).toContain("EUR110.00");
  });
  it("falls back to the payment URL, then a text reference", () => {
    expect(
      resolveInvoiceQrPayload(
        { ...base, paymentUrl: "https://pay.example/i" },
        { businessName: "B" },
      ),
    ).toBe("https://pay.example/i");
    expect(resolveInvoiceQrPayload(base, { businessName: "B" })).toBe(
      "Invoice INV-1001: USD 110.00",
    );
  });
});

describe("currencies", () => {
  it("has 120+ currencies and known codes", () => {
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(120);
    for (const code of ["USD", "EUR", "GBP", "JPY", "INR", "BRL", "ZAR"]) {
      expect(isKnownCurrency(code)).toBe(true);
    }
    expect(isKnownCurrency("usd")).toBe(true);
    expect(isKnownCurrency("XX1")).toBe(false);
  });
});
