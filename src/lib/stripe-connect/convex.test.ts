/// <reference types="vite/client" />
import { afterEach, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../../convex/schema";
const modules = import.meta.glob("../../../convex/**/*.{ts,js}");
const query = (name: string) => makeFunctionReference<"query">(`stripeConnections:${name}`);
const mutation = (name: string) => makeFunctionReference<"mutation">(`stripeConnections:${name}`);
const serverSecret = "synthetic-bridge-test-credential-1234567890";
const input = {userId:"a",accountId:"acct_a",livemode:false,chargesEnabled:true,payoutsEnabled:null,secretEnvelope:"encrypted-fixture",serverSecret};
afterEach(()=>vi.unstubAllEnvs());
it("isolates credentials from browser access and metadata, binds owner/account/mode and revokes", async()=>{
  vi.stubEnv("TALLY_CONVEX_SERVER_SECRET",serverSecret);
  const t=convexTest(schema,modules), a=t.withIdentity({subject:"a"}), b=t.withIdentity({subject:"b"});
  await t.mutation(mutation("save"),input);
  expect(await a.query(query("metadata"),{userId:"a"})).not.toHaveProperty("secretEnvelope");
  await expect(b.query(query("metadata"),{userId:"a"})).rejects.toThrow();
  await expect(a.query(query("credential"),{userId:"a",accountId:"acct_a",livemode:false,serverSecret:"wrong"})).rejects.toThrow();
  await expect(a.mutation(mutation("save"),{...input,serverSecret:"wrong"})).rejects.toThrow();
  expect(await t.query(query("credential"),{userId:"b",accountId:"acct_a",livemode:false,serverSecret})).toBeNull();
  expect(await t.query(query("credential"),{userId:"a",accountId:"acct_a",livemode:true,serverSecret})).toBeNull();
  expect(await t.query(query("credential"),{userId:"a",accountId:"acct_a",livemode:false,serverSecret})).toBe("encrypted-fixture");
  expect(await t.query(query("ownerForAccount"),{accountId:"acct_a",livemode:true,serverSecret})).toBeNull();
  await expect(t.mutation(mutation("save"),{...input,userId:"b"})).rejects.toThrow();
  await t.mutation(mutation("save"),{...input,userId:"b",livemode:true});
  expect(await t.query(query("ownerForAccount"),{accountId:"acct_a",livemode:true,serverSecret})).toBe("b");
  await t.mutation(mutation("remove"),{userId:"a",serverSecret});
  expect(await t.query(query("credential"),{userId:"a",accountId:"acct_a",livemode:false,serverSecret})).toBeNull();
});
