export type AppDataMode = "cloud" | "local";

export type DataModeCopy = {
  navigationStatus: string;
  logoSizeWarning: (sizeKb: string) => string;
  logoStorage: string;
  receiptStorage: string;
  receiptSizeWarning: (sizeKb: string) => string;
  resetConfirmation: string;
};

const COPY: Record<AppDataMode, DataModeCopy> = {
  cloud: {
    navigationStatus: "Cloud mode · Multi-device",
    logoSizeWarning: (sizeKb) =>
      `Logo is ${sizeKb} KB — larger than 500 KB will increase storage and sync size.`,
    logoStorage:
      "Stored securely with your account data. Keep it under 500 KB.",
    receiptStorage:
      "Images are resized (max 1600px) and saved with your account data.",
    receiptSizeWarning: (sizeKb) =>
      `Receipt is about ${sizeKb} KB after compressing — large images increase storage and sync size.`,
    resetConfirmation:
      "Delete ALL Tallyhand data? When cloud sync is on, this also removes the synced copies from your account.",
  },
  local: {
    navigationStatus: "Local mode · Offline-ready",
    logoSizeWarning: (sizeKb) =>
      `Logo is ${sizeKb} KB — larger than 500 KB will use more browser storage.`,
    logoStorage: "Stored in this browser. Keep it under 500 KB.",
    receiptStorage:
      "Images are resized (max 1600px) and stored in this browser.",
    receiptSizeWarning: (sizeKb) =>
      `Receipt is about ${sizeKb} KB after compressing — large images use more browser storage.`,
    resetConfirmation: "Delete ALL local Tallyhand data in this browser?",
  },
};

export function dataModeCopy(mode: AppDataMode): DataModeCopy {
  return COPY[mode];
}
