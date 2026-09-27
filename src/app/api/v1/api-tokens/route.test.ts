/**
 * /api/v1/api-tokens route tests.
 *
 * TALLY_AUTH=none → 404 (no signed-in users exist in single-user local
 * mode). Session-authed behavior (clerk/builtin) is covered by
 * requireSessionUserId()'s contract in session.ts; exercising real Clerk
 * sessions needs live keys and is verified manually.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

describe("api-tokens routes in single-user local mode", () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    delete process.env.TALLY_AUTH;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  });

  afterEach(() => {
    process.env = saved;
  });

  it("GET → 404", async () => {
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("POST → 404", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/v1/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("DELETE → 404", async () => {
    const res = await DELETE(
      new Request("http://localhost:3000/api/v1/api-tokens/tok_x", {
        method: "DELETE",
      }),
      { params: { id: "tok_x" } },
    );
    expect(res.status).toBe(404);
  });
});
