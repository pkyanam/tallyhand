import { describe, expect, it } from "vitest";
import { invoicePdfModel } from "./invoice-pdf-model";
import { DEFAULT_SETTINGS } from "@/core/entities";
import type { Invoice, InvoiceLineItem, Settings } from "@/core/entities";

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

function legacyInvoice(partial: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv1",
    clientId: "c1",
    invoiceNumber: "INV-1001",
    issueDate: 1,
    dueDate: 2,
    status: "draft",
    lineItems: [],
    subtotal: 125,
    total: 125,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function settings(partial: Partial<Settings["invoice"]> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    invoice: { ...DEFAULT_SETTINGS.invoice, ...partial },
  };
}

describe("invoicePdfModel — legacy invoice", () => {
  it("resolves legacy defaults: USD, LETTER, Sales tax, Tax ID, no tax rows", () => {
    const model = invoicePdfModel(
      legacyInvoice({
        lineItems: [line({ amount: 100 }), line({ amount: 25 })],
      }),
      settings(),
    );
    expect(model.currency).toBe("USD");
    expect(model.region).toBe("US");
    expect(model.pageSize).toBe("LETTER");
    expect(model.documentType).toBe("Invoice");
    expect(model.taxLabel).toBe("Sales tax");
    expect(model.sellerTaxIdLabel).toBe("Tax ID");
    expect(model.buyerTaxIdLabel).toBe("Tax ID");
    expect(model.hasTaxColumn).toBe(false);
    expect(model.hasTaxRows).toBe(false);
    expect(model.taxGroups).toEqual([]);
    expect(model.taxTotal).toBe(0);
    // Stored totals pass through untouched.
    expect(model.subtotal).toBe(125);
    expect(model.total).toBe(125);
    expect(model.amountInWordsText).toBeNull();
    expect(model.qrPayload).toBeNull();
    expect(model.showSellerEmail).toBe(true);
    expect(model.showBuyerEmail).toBe(true);
    expect(model.bankAccountLabel).toBe("Account");
    expect(model.servicePeriod).toBeNull();
    expect(model.hasPaymentBlock).toBe(false);
    expect(model.template).toBe("default");
  });

  it("keeps the seller tax ID from settings with the settings label", () => {
    const s = settings();
    s.business.taxId = "12-3456789";
    const model = invoicePdfModel(legacyInvoice(), s);
    expect(model.sellerTaxId).toBe("12-3456789");
    expect(model.sellerTaxIdLabel).toBe("Tax ID");
  });
});

describe("invoicePdfModel — EU invoice", () => {
  it("resolves EUR, A4, VAT, VAT ID, IBAN", () => {
    const model = invoicePdfModel(
      legacyInvoice({ taxRegion: "EU" }),
      settings({ defaultCurrency: "", taxIdLabel: "" }),
    );
    expect(model.currency).toBe("EUR");
    expect(model.region).toBe("EU");
    expect(model.pageSize).toBe("A4");
    expect(model.taxLabel).toBe("VAT");
    expect(model.sellerTaxIdLabel).toBe("VAT ID");
    expect(model.buyerTaxIdLabel).toBe("VAT ID");
    expect(model.bankAccountLabel).toBe("IBAN");
  });

  it("uppercases an explicit invoice currency and honors invoice tax ID label", () => {
    const model = invoicePdfModel(
      legacyInvoice({
        taxRegion: "EU",
        currency: "gbp",
        sellerTaxIdLabel: "VAT No.",
        buyerTaxId: "DE123456789",
      }),
      settings({ defaultCurrency: "USD" }),
    );
    expect(model.currency).toBe("GBP");
    expect(model.sellerTaxIdLabel).toBe("VAT No.");
    expect(model.buyerTaxId).toBe("DE123456789");
  });
});

describe("invoicePdfModel — tax groups", () => {
  it("resolves per-line tax column and grouped summary rows", () => {
    const model = invoicePdfModel(
      legacyInvoice({
        lineItems: [
          line({ amount: 100, taxRate: 8.5, taxLabel: "State tax" }),
          line({ amount: 200, taxRate: 8.5, taxLabel: "State tax" }),
          line({ amount: 50, taxRate: 20, taxLabel: "Reduced" }),
          line({ amount: 40, taxRate: 20 }),
        ],
        subtotal: 390,
        total: 448.5,
      }),
      settings(),
    );
    expect(model.hasTaxColumn).toBe(true);
    expect(model.hasTaxRows).toBe(true);
    expect(model.taxTotal).toBe(8.5 + 17 + 10 + 8);
    expect(model.subtotal).toBe(390);
    expect(model.total).toBeCloseTo(433.5, 2);
    expect(model.taxGroups.map((g) => g.rate)).toEqual([8.5, 20]);
    // Uniform per-line label survives; mixed labels fall back to the
    // region-aware default.
    expect(model.taxGroups[0]).toMatchObject({
      label: "State tax",
      taxable: 300,
      tax: 25.5,
    });
    expect(model.taxGroups[1]).toMatchObject({
      label: "Sales tax (20%)",
      taxable: 90,
      tax: 18,
    });
  });

  it("uses the VAT fallback label for EU groups without a uniform label", () => {
    const model = invoicePdfModel(
      legacyInvoice({
        taxRegion: "EU",
        lineItems: [line({ amount: 100, taxRate: 20 })],
        subtotal: 100,
        total: 120,
      }),
      settings(),
    );
    expect(model.taxGroups[0].label).toBe("VAT (20%)");
  });
});

describe("invoicePdfModel — amount in words", () => {
  it("is null unless enabled", () => {
    const model = invoicePdfModel(legacyInvoice(), settings());
    expect(model.amountInWordsText).toBeNull();
  });

  it("spells out the total when enabled on the invoice", () => {
    const model = invoicePdfModel(
      legacyInvoice({ amountInWords: true, subtotal: 100, total: 100 }),
      settings(),
    );
    expect(model.amountInWordsText).toBe("One hundred dollars");
  });

  it("follows the settings default when the invoice does not opt in", () => {
    const model = invoicePdfModel(
      legacyInvoice({ subtotal: 1234.56, total: 1234.56 }),
      settings({ amountInWordsDefault: true, defaultCurrency: "EUR" }),
    );
    expect(model.amountInWordsText).toBe(
      "One thousand two hundred thirty-four euros and fifty-six cents",
    );
  });

  it("lets the invoice opt out of the settings default", () => {
    const model = invoicePdfModel(
      legacyInvoice({ amountInWords: false }),
      settings({ amountInWordsDefault: true }),
    );
    expect(model.amountInWordsText).toBeNull();
  });
});

describe("invoicePdfModel — QR, email visibility, payment", () => {
  it("returns null QR payload when QR is disabled", () => {
    const model = invoicePdfModel(
      legacyInvoice({ paymentUrl: "https://pay.example/1" }),
      settings(),
    );
    expect(model.qrPayload).toBeNull();
  });

  it("resolves the payment URL as the QR payload when enabled", () => {
    const model = invoicePdfModel(
      legacyInvoice({
        qrEnabled: true,
        paymentUrl: "https://pay.example/1",
        qrDescription: "Scan to pay",
      }),
      settings(),
    );
    expect(model.qrPayload).toBe("https://pay.example/1");
    expect(model.qrDescription).toBe("Scan to pay");
  });

  it("builds an EPC payload for EU invoices with an IBAN", () => {
    const model = invoicePdfModel(
      legacyInvoice({
        taxRegion: "EU",
        currency: "EUR",
        qrEnabled: true,
        bankAccount: "DE75512108001245126199",
        swiftBic: "BELADEBEXXX",
        subtotal: 120,
        total: 120,
      }),
      settings({ defaultCurrency: "EUR" }),
    );
    expect(model.qrPayload).toContain("BCD");
    expect(model.qrPayload).toContain("DE75512108001245126199");
  });

  it("defaults email visibility to true and honors explicit flags", () => {
    const shown = invoicePdfModel(legacyInvoice(), settings());
    expect(shown.showSellerEmail).toBe(true);
    expect(shown.showBuyerEmail).toBe(true);
    const hidden = invoicePdfModel(
      legacyInvoice({ sellerEmailVisible: false, buyerEmailVisible: false }),
      settings(),
    );
    expect(hidden.showSellerEmail).toBe(false);
    expect(hidden.showBuyerEmail).toBe(false);
  });

  it("resolves the payment block and service period", () => {
    const model = invoicePdfModel(
      legacyInvoice({
        paymentMethod: "Bank transfer",
        paymentUrl: "https://pay.example/1",
        bankAccount: "DE75512108001245126199",
        swiftBic: "BELADEBEXXX",
        serviceStart: 1_000,
        serviceEnd: 2_000,
        invoiceType: "Proforma invoice",
      }),
      settings(),
    );
    expect(model.hasPaymentBlock).toBe(true);
    expect(model.paymentMethod).toBe("Bank transfer");
    expect(model.paymentUrl).toBe("https://pay.example/1");
    expect(model.bankAccount).toBe("DE75512108001245126199");
    expect(model.swiftBic).toBe("BELADEBEXXX");
    expect(model.servicePeriod).toEqual({ start: 1_000, end: 2_000 });
    expect(model.documentType).toBe("Proforma invoice");
    // US invoice → bank account is not labeled IBAN.
    expect(model.bankAccountLabel).toBe("Account");
  });

  it("prefers the invoice seller tax ID over settings", () => {
    const s = settings();
    s.business.taxId = "12-3456789";
    const model = invoicePdfModel(
      legacyInvoice({ sellerTaxId: "OVERRIDE-1" }),
      s,
    );
    expect(model.sellerTaxId).toBe("OVERRIDE-1");
  });

  it("reports the stripe template", () => {
    const model = invoicePdfModel(
      legacyInvoice({ template: "stripe" }),
      settings(),
    );
    expect(model.template).toBe("stripe");
  });
});
