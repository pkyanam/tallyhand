"use client";

import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/app/page-header";
import { useAppChrome } from "@/components/app/app-chrome-provider";
import { settingsRepo } from "@/lib/db/repos";
import { formatInvoiceNumber } from "@/lib/invoice-helpers";
import type { Settings } from "@/lib/db/types";

const MAX_LOGO_BYTES = 500 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function SettingsContent() {
  const settings = useLiveQuery(() => settingsRepo.read(), []);
  const { showNotice } = useAppChrome();

  React.useEffect(() => {
    void settingsRepo.get();
  }, []);

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" />
        <Card>
          <CardContent className="p-10 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </>
    );
  }

  const updateBusiness = async (patch: Partial<Settings["business"]>) => {
    await settingsRepo.update({
      business: { ...settings.business, ...patch },
    });
  };

  const updateInvoice = async (patch: Partial<Settings["invoice"]>) => {
    await settingsRepo.update({
      invoice: { ...settings.invoice, ...patch },
    });
  };

  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      showNotice(
        `Logo is ${(file.size / 1024).toFixed(0)} KB — larger than 500 KB will bloat IndexedDB.`,
      );
    }
    const dataUrl = await readFileAsDataUrl(file);
    await updateInvoice({ logoB64: dataUrl });
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Business info and invoice defaults. The Reckoning, expense categories, and data tools land in later stages."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
            <CardDescription>
              Appears at the top of every invoice you generate.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FieldInput
              label="Business name"
              defaultValue={settings.business.name}
              onCommit={(v) => updateBusiness({ name: v })}
              placeholder="Acme Design Studio"
            />
            <FieldInput
              label="Owner / contact name"
              defaultValue={settings.business.ownerName}
              onCommit={(v) => updateBusiness({ ownerName: v })}
              placeholder="Your name"
            />
            <FieldInput
              label="Email"
              type="email"
              defaultValue={settings.business.email}
              onCommit={(v) => updateBusiness({ email: v })}
              placeholder="billing@your-domain.com"
            />
            <FieldInput
              label="Tax ID"
              defaultValue={settings.business.taxId}
              onCommit={(v) => updateBusiness({ taxId: v })}
              placeholder="EIN / ABN / VAT"
            />
            <FieldTextarea
              label="Address"
              className="sm:col-span-2"
              rows={3}
              defaultValue={settings.business.address}
              onCommit={(v) => updateBusiness({ address: v })}
              placeholder="Street, city, postal code"
            />
            <FieldTextarea
              label="Payment instructions"
              className="sm:col-span-2"
              rows={4}
              defaultValue={settings.business.paymentInstructions}
              onCommit={(v) => updateBusiness({ paymentInstructions: v })}
              placeholder="ACH, wire, check, Stripe link, etc."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              Numbering, appearance, and payment terms.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-[200px_120px_1fr]">
              <FieldInput
                label="Number prefix"
                defaultValue={settings.invoice.numberPrefix}
                onCommit={(v) => updateInvoice({ numberPrefix: v })}
                placeholder="INV-"
              />
              <div className="grid gap-1.5">
                <Label>Next number</Label>
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 font-mono text-sm tabular-nums text-muted-foreground">
                  {settings.invoice.nextNumber}
                </div>
                <p className="text-xs text-muted-foreground">
                  Auto-bumps on save.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>Preview</Label>
                <div className="flex h-9 items-center rounded-md border border-dashed border-input px-3 font-mono text-sm tabular-nums">
                  {formatInvoiceNumber(
                    settings.invoice.numberPrefix,
                    settings.invoice.nextNumber,
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[160px_200px]">
              <FieldNumber
                label="Payment terms (days)"
                defaultValue={settings.invoice.paymentTermsDays}
                onCommit={(n) =>
                  updateInvoice({ paymentTermsDays: Math.max(0, n) })
                }
                placeholder="14"
              />
              <div className="grid gap-1.5">
                <Label htmlFor="accent-color">Accent color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="accent-color"
                    type="color"
                    className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
                    defaultValue={settings.invoice.accentColor}
                    onChange={(e) =>
                      updateInvoice({ accentColor: e.target.value })
                    }
                  />
                  <Input
                    className="h-9 flex-1 font-mono text-xs"
                    defaultValue={settings.invoice.accentColor}
                    key={`color-${settings.invoice.accentColor}`}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== settings.invoice.accentColor)
                        updateInvoice({ accentColor: v });
                    }}
                  />
                </div>
              </div>
            </div>

            <FieldTextarea
              label="Footer text"
              rows={2}
              defaultValue={settings.invoice.footerText}
              onCommit={(v) => updateInvoice({ footerText: v })}
              placeholder="Thank you for your business."
            />

            <div className="grid gap-1.5">
              <Label>Logo</Label>
              <div className="flex items-center gap-3">
                {settings.invoice.logoB64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={settings.invoice.logoB64}
                    alt="Current logo"
                    className="h-12 w-auto rounded-md border bg-background p-1"
                  />
                ) : (
                  <div className="flex h-12 w-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                    No logo
                  </div>
                )}
                <div className="flex gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                    <ImageUp className="h-4 w-4" />
                    Upload
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml"
                      className="hidden"
                      onChange={(e) =>
                        handleLogoFile(e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  {settings.invoice.logoB64 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => updateInvoice({ logoB64: undefined })}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Stored inline in your browser as base64. Keep it under 500 KB.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function FieldInput({
  label,
  defaultValue,
  onCommit,
  placeholder,
  type,
}: {
  label: string;
  defaultValue: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        defaultValue={defaultValue}
        key={`${label}-${defaultValue}`}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== defaultValue) onCommit(v);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

function FieldTextarea({
  label,
  defaultValue,
  onCommit,
  placeholder,
  rows,
  className,
}: {
  label: string;
  defaultValue: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      <Textarea
        rows={rows}
        defaultValue={defaultValue}
        key={`${label}-${defaultValue}`}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== defaultValue) onCommit(v);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}

function FieldNumber({
  label,
  defaultValue,
  onCommit,
  placeholder,
}: {
  label: string;
  defaultValue: number;
  onCommit: (value: number) => void;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode="numeric"
        defaultValue={String(defaultValue)}
        key={`${label}-${defaultValue}`}
        onBlur={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n) && n !== defaultValue) onCommit(n);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
