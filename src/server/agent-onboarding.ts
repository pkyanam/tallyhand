import type { Settings } from "@/core/entities";

export const ONBOARDING_INTENTS = ["time_tracking", "invoicing"] as const;
export type OnboardingIntent = typeof ONBOARDING_INTENTS[number];

/** Product readiness is distinct from authorization and individual invoice validity. */
export function onboardingReadiness(settings: Settings, intent: OnboardingIntent = "time_tracking") {
  const missingConfiguration = !settings.business.name.trim() ? [{
    field: "business.name", reason: "Set the seller name displayed on invoices", blocking: intent === "invoicing",
    step: "configure_business",
  }] : [];
  const readinessByIntent = { time_tracking: true, invoicing: missingConfiguration.length === 0 };
  return {
    intent, ready: readinessByIntent[intent], readinessByIntent, missingConfiguration,
    nextSteps: [
      ...(missingConfiguration.length ? [{ id: "configure_business", method: "POST", path: "/api/v1/onboarding", bodyTemplate: { settings: { business: { name: "<seller name>" } }, intent, dryRun: true }, requiresInput: ["business.name"], requiredScope: "tally:write" }] : []),
      { id: "create_client", method: "POST", path: "/api/v1/clients", bodyTemplate: { name: "<client name>" }, requiresInput: ["name"], requiredScope: "tally:write" },
      ...(intent === "time_tracking" ? [{ id: "create_project", method: "POST", path: "/api/v1/projects", bodyTemplate: { name: "<project name>", clientId: "<created client id>" }, requiresInput: ["name", "clientId"], requiredScope: "tally:write" },
      { id: "create_task", method: "POST", path: "/api/v1/tasks", bodyTemplate: { name: "<task name>", projectId: "<created project id>", startAt: "<epoch milliseconds>", endAt: "<epoch milliseconds>" }, requiresInput: ["name", "projectId", "startAt", "endAt"], requiredScope: "tally:write" }] : [{ id: "create_invoice", method: "POST", path: "/api/v1/invoices", requiresInput: ["clientId", "issueDate", "lineItems"], requiredScope: "tally:write" }]),
    ],
    defaults: { currency: settings.invoice.defaultCurrency, invoicePrefix: settings.invoice.numberPrefix, paymentTermsDays: settings.invoice.paymentTermsDays },
    note: "Readiness describes workspace configuration. Client, task, and invoice inputs and caller authorization are validated by each operation. Review currency, tax, and payment preferences before issuing an invoice.",
  };
}
