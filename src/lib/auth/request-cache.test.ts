import { expect, it, vi } from "vitest";
import { memoRequestAuth, withRequestAuthCache, withApiRequestCache } from "./request-cache";
it("coalesces duplicate checks only within the same request", async () => {
  const verify = vi.fn(async () => ({ userId: "fixture" }));
  await withRequestAuthCache(async () => { await Promise.all([memoRequestAuth("fixture", verify), memoRequestAuth("fixture", verify)]); });
  expect(verify).toHaveBeenCalledTimes(1);
  await withRequestAuthCache(() => memoRequestAuth("fixture", verify));
  expect(verify).toHaveBeenCalledTimes(2);
});
it("isolates concurrent requests", async () => {
  const users = await Promise.all(["one", "two"].map(user => withRequestAuthCache(() => memoRequestAuth("same-key", async () => user))));
  expect(users).toEqual(["one", "two"]);
});

it("reuses MCP auth in nested REST handlers but resets between REST requests", async () => {
  const verify = vi.fn(async () => "fixture-user");
  const handler = withApiRequestCache(async () => Response.json(await memoRequestAuth("token", verify)));
  await withRequestAuthCache(async () => {
    await memoRequestAuth("token", verify);
    await handler();
  });
  expect(verify).toHaveBeenCalledTimes(1);
  await handler();
  expect(verify).toHaveBeenCalledTimes(2);
});
