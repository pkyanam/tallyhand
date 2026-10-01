import { DEFAULT_SETTINGS, type Settings } from "@/core/entities";

/** Deep-merge persisted settings with defaults so new fields survive migrations. */
export function normalizeSettings(raw: Settings): Settings {
  const normalizedTheme = raw.appearance?.theme === "dark" ? "dark" : "light";

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    id: "singleton",
    business: { ...DEFAULT_SETTINGS.business, ...raw.business, billingEmails: Array.isArray(raw.business?.billingEmails) ? raw.business.billingEmails : [] },
    invoice: { ...DEFAULT_SETTINGS.invoice, ...raw.invoice },
    reckoning: {
      ...DEFAULT_SETTINGS.reckoning,
      ...raw.reckoning,
    },
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...raw.appearance,
      theme: normalizedTheme,
    },
    dunning: {
      ...DEFAULT_SETTINGS.dunning,
      ...raw.dunning,
      lateFee: {
        ...DEFAULT_SETTINGS.dunning.lateFee,
        ...raw.dunning?.lateFee,
      },
    },
    tax: { ...DEFAULT_SETTINGS.tax, ...raw.tax },
    analytics: { ...DEFAULT_SETTINGS.analytics, ...raw.analytics },
    expenseCategories:
      raw.expenseCategories?.length > 0
        ? [...raw.expenseCategories]
        : [...DEFAULT_SETTINGS.expenseCategories],
  };
}
