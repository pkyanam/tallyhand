import { describe, expect, it, afterEach } from "vitest";
import {
  applyOcrResult,
  clearReceiptOcrProviders,
  listReceiptOcrProviders,
  registerReceiptOcrProvider,
} from "./receipt-ocr";

afterEach(() => {
  clearReceiptOcrProviders();
});

describe("receipt OCR provider registry", () => {
  it("starts empty", () => {
    expect(listReceiptOcrProviders()).toEqual([]);
  });

  it("registers and unregisters providers", () => {
    const unregister = registerReceiptOcrProvider({
      id: "test",
      name: "Test",
      extract: async () => ({ confidence: 1 }),
    });
    expect(listReceiptOcrProviders()).toHaveLength(1);
    unregister();
    expect(listReceiptOcrProviders()).toEqual([]);
  });

  it("re-registering the same id replaces the provider", () => {
    registerReceiptOcrProvider({
      id: "test",
      name: "One",
      extract: async () => ({ confidence: 0.5 }),
    });
    registerReceiptOcrProvider({
      id: "test",
      name: "Two",
      extract: async () => ({ confidence: 0.9 }),
    });
    const providers = listReceiptOcrProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("Two");
  });
});

describe("applyOcrResult", () => {
  it("fills blanks without overwriting user input", () => {
    const merged = applyOcrResult(
      { amount: "12.50", date: "" },
      { amount: 99.99, date: "2026-09-20", confidence: 0.9 },
    );
    expect(merged.amount).toBe("12.50");
    expect(merged.date).toBe("2026-09-20");
  });

  it("fills empty fields", () => {
    const merged = applyOcrResult(
      { amount: "", date: "" },
      { amount: 42, confidence: 0.8 },
    );
    expect(merged.amount).toBe("42");
    expect(merged.date).toBe("");
  });

  it("ignores non-finite amounts", () => {
    const merged = applyOcrResult(
      { amount: "", date: "" },
      { amount: Number.NaN, confidence: 0.1 },
    );
    expect(merged.amount).toBe("");
  });
});
