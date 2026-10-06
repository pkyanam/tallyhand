import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { makeRequest, TEST_TOKEN } from "../_tests/helpers";
describe("agent control contract", () => {
  it("distinguishes authorized browser operation from external consent", async () => {
    process.env.TALLYHAND_API_TOKEN = TEST_TOKEN;
    const account = (await (await GET(makeRequest("/api/v1/controls?control=account"))).json()).data;
    expect(account).toMatchObject({ requiresUserInteraction: true, interaction: "agent_browser", requiresHumanConsent: false, bearerApiAvailable: false });
    const payments = (await (await GET(makeRequest("/api/v1/controls?control=payments"))).json()).data;
    expect(payments).toMatchObject({ interaction: "external_consent", requiresHumanConsent: true });
    expect((await GET(makeRequest("/api/v1/controls?control=unknown"))).status).toBe(400);
  });
});
