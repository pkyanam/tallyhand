import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { deleteStripeConnection, findUserIdByStripeAccount, getStripeConnectionMeta, getStripeConnectionSecret, saveStripeConnection } from "./store";
import { __resetStripeConnectionCaches } from "./store";
let dir="";
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),"stripe-store-"));process.env.TALLY_STORAGE="sqlite";process.env.TALLYHAND_DB_PATH=join(dir,"db.sqlite");process.env.TALLY_ENCRYPTION_KEY="ab".repeat(32);});
afterEach(()=>{__resetStripeConnectionCaches();rmSync(dir,{recursive:true,force:true});});
async function save(user="u",account="acct_1",token="tok") { const {encryptSecret}=await import("@/lib/crypto/connect-crypto");return saveStripeConnection(user,{accountId:account,livemode:true,chargesEnabled:true,payoutsEnabled:false,secretEnvelope:encryptSecret(token)}); }
describe("stripe connection store",()=>{
it("returns metadata without envelope or plaintext",async()=>{await save();const m=await getStripeConnectionMeta("u");expect(m).toMatchObject({accountId:"acct_1"});expect(JSON.stringify(m)).not.toContain("tok");expect(JSON.stringify(m)).not.toContain("secretEnvelope");});
it("decrypts stored secret transiently",async()=>{await save();expect(await getStripeConnectionSecret("u")).toBe("tok");});
it("routes webhook by account",async()=>{await save();expect(await findUserIdByStripeAccount("acct_1")).toBe("u");});
it("upserts reconnect",async()=>{await save("u","acct_1","old");await save("u","acct_2","new");expect(await findUserIdByStripeAccount("acct_1")).toBeNull();expect(await getStripeConnectionSecret("u")).toBe("new");});
it("deletes on disconnect",async()=>{await save();await deleteStripeConnection("u");expect(await getStripeConnectionMeta("u")).toBeNull();});
it("fails closed without encryption key",async()=>{await save();delete process.env.TALLY_ENCRYPTION_KEY;await expect(getStripeConnectionSecret("u")).rejects.toThrow();});
it("returns null for unknown user",async()=>expect(await getStripeConnectionMeta("nobody")).toBeNull());
});
