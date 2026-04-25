import { DEFAULT_SETTINGS, type Settings } from "@/lib/db/types";

/** Deep-merge persisted settings with defaults so new fields survive migrations. */
export function normalizeSettings(raw: Settings): Settings {
  const normalizedTheme = raw.appearance?.theme === "dark" ? "dark" : "light";

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    id: "singleton",
    business: { ...DEFAULT_SETTINGS.business, ...raw.business },
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
    expenseCategories:
      raw.expenseCategories?.length > 0
        ? [...raw.expenseCategories]
        : [...DEFAULT_SETTINGS.expenseCategories],
  };
}
