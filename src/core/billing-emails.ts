import { z } from "zod";
import type { Settings } from "./entities";
/** Additional invoice contact addresses are display-only, never implicit recipients. */
export function parseBillingEmailsInput(value: string): string[] {
  const emails = value.split(/[,;\n]+/).map(email => email.trim()).filter(Boolean);
  const unique = [...new Map(emails.map(email => [email.toLowerCase(), email])).values()];
  return z.array(z.string().email()).max(10).parse(unique);
}
export function billingEmailDisplay(business: Settings["business"]): string {
  const values = [business.email, ...(business.billingEmails ?? [])].filter(email => typeof email === "string" && email.trim()).map(email => email.trim());
  return [...new Map(values.map(email => [email.toLowerCase(), email])).values()].join(", ");
}
