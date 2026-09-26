import { describe, expect, it } from "vitest";
import {
  buildShareableInvoiceHtml,
  shareInvoiceFileName,
} from "./invoice-share-file";
import type { Client, Invoice, Settings } from "@/core/entities";
import { DEFAULT_SETTINGS } from "@/core/entities";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_1",
    clientId: "c_1",
    invoiceNumber: "INV-0042",
    issueDate: 1758835200000,
    dueDate: 1759440000000,
    status: "sent",
    lineItems: [
      {
        id: "li_1",
        description: "Backend work",
        quantity: 3,
        rate: 150,
        amount: 450,
      },
    ],
    subtotal: 450,
    total: 450,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    business: {
      ...DEFAULT_SETTINGS.business,
      name: "Acme Studio",
      email: "hello@acme.test",
    },
    ...overrides,
  };
}

describe("buildShareableInvoiceHtml", () => {
  it("renders invoice content: number, line items, totals", () => {
    const html = buildShareableInvoiceHtml({ invoice: makeInvoice() });
    expect(html).toContain("INV-0042");
    expect(html).toContain("Backend work");
    expect(html).toContain("$450.00");
    expect(html).toContain("Total due");
  });

  it("escapes HTML special chars in every user-controlled field", () => {
    const evil = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;
    const invoice = makeInvoice({
      invoiceNumber: evil,
      notes: evil,
      lineItems: [
        { id: "li_1", description: evil, quantity: 1, rate: 1, amount: 1 },
      ],
    });
    const client: Client = {
      id: "c_1",
      name: evil,
      email: evil,
      address: evil,
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    };
    const settings = makeSettings({
      business: {
        ...DEFAULT_SETTINGS.business,
        name: evil,
        ownerName: evil,
        address: evil,
        email: evil,
        taxId: evil,
        paymentInstructions: evil,
      },
      invoice: {
        ...DEFAULT_SETTINGS.invoice,
        footerText: evil,
        accentColor: evil,
      },
    });
    const html = buildShareableInvoiceHtml({ invoice, client, settings });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain(evil);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("makes no external requests: no remote src/href, imports, or url()", () => {
    const html = buildShareableInvoiceHtml({
      invoice: makeInvoice(),
      settings: makeSettings(),
    });
    expect(html).not.toMatch(/src="https?:/i);
    expect(html).not.toMatch(/href="https?:/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(\s*https?:/i);
    expect(html).not.toContain("<link");
  });

  it("is print-friendly: has @page and @media print hiding the banner", () => {
    const html = buildShareableInvoiceHtml({ invoice: makeInvoice() });
    expect(html).toContain("@page");
    expect(html).toContain("@media print");
  });

  it("shows the invoice status (PAID stays visible)", () => {
    expect(
      buildShareableInvoiceHtml({ invoice: makeInvoice({ status: "paid" }) }),
    ).toContain("PAID");
    expect(
      buildShareableInvoiceHtml({ invoice: makeInvoice({ status: "draft" }) }),
    ).toContain("DRAFT");
  });

  it("handles missing client/settings and empty line items gracefully", () => {
    const html = buildShareableInvoiceHtml({
      invoice: makeInvoice({ lineItems: [] }),
    });
    expect(html).toContain("No line items.");
    expect(html).toContain("Your business");
  });

  it("inlines a valid raster logo and rejects scriptable/malformed ones", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const withLogo = buildShareableInvoiceHtml({
      invoice: makeInvoice(),
      settings: makeSettings({
        invoice: {
          ...DEFAULT_SETTINGS.invoice,
          logoB64: png,
        },
      }),
    });
    expect(withLogo).toContain('src="data:image/png;base64,iVBORw0KGgo="');

    for (const bad of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==",
      "data:text/html,<script>alert(1)</script>",
      'data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)',
    ]) {
      const html = buildShareableInvoiceHtml({
        invoice: makeInvoice(),
        settings: makeSettings({
          invoice: { ...DEFAULT_SETTINGS.invoice, logoB64: bad },
        }),
      });
      expect(html).not.toContain("<img");
    }
  });

  it("falls back to the default accent color for non-hex values", () => {
    const bad = buildShareableInvoiceHtml({
      invoice: makeInvoice(),
      settings: makeSettings({
        invoice: { ...DEFAULT_SETTINGS.invoice, accentColor: "red;}</style><script>" },
      }),
    });
    expect(bad).not.toContain("red;");
    expect(bad).toContain("#111111");

    const good = buildShareableInvoiceHtml({
      invoice: makeInvoice(),
      settings: makeSettings({
        invoice: { ...DEFAULT_SETTINGS.invoice, accentColor: "#2563eb" },
      }),
    });
    expect(good).toContain("#2563eb");
  });
});

describe("shareInvoiceFileName", () => {
  it("builds a safe filename from the invoice number", () => {
    expect(shareInvoiceFileName(makeInvoice())).toBe("inv-0042-invoice.html");
    expect(
      shareInvoiceFileName(makeInvoice({ invoiceNumber: 'INV "0042" / Q3' })),
    ).toBe("inv-0042-q3-invoice.html");
    expect(shareInvoiceFileName(makeInvoice({ invoiceNumber: "" }))).toBe(
      "invoice.html",
    );
  });
});
