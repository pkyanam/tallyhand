import { beforeEach, describe, expect, it, vi } from "vitest";
import { CryptoConfigError, DecryptionError, decryptSecret, encryptSecret, signState, verifyState } from "./connect-crypto";
const KEY="ab".repeat(32);
beforeEach(()=>{process.env.TALLY_ENCRYPTION_KEY=KEY;vi.restoreAllMocks();});
describe("Connect crypto",()=>{
 it("round trips secrets",()=>expect(decryptSecret(encryptSecret("sk_test_private"))).toBe("sk_test_private"));
 it("uses random IVs",()=>expect(encryptSecret("same")).not.toBe(encryptSecret("same")));
 it("rejects wrong key",()=>{const e=encryptSecret("secret");process.env.TALLY_ENCRYPTION_KEY="cd".repeat(32);expect(()=>decryptSecret(e)).toThrow(DecryptionError);});
 it.each(["iv","ct","tag"] as const)("rejects tampered %s",field=>{const e=JSON.parse(encryptSecret("secret"));const b=Buffer.from(e[field],"base64url");b[0]=b[0]^1;e[field]=b.toString("base64url");expect(()=>decryptSecret(JSON.stringify(e))).toThrow(DecryptionError);});
 it.each(["{",JSON.stringify({v:2,alg:"aes-256-gcm",iv:"",ct:"",tag:""}),JSON.stringify({v:1,alg:"bad",iv:"",ct:"",tag:""}),JSON.stringify({v:1})])("rejects malformed envelope %s",e=>expect(()=>decryptSecret(e)).toThrow(DecryptionError));
 it("fails on wrong length and non-hex key",()=>{process.env.TALLY_ENCRYPTION_KEY="abc";expect(()=>encryptSecret("x")).toThrow(CryptoConfigError);process.env.TALLY_ENCRYPTION_KEY="g".repeat(64);expect(()=>encryptSecret("x")).toThrow(CryptoConfigError);});
 it("fails when key is missing",()=>{delete process.env.TALLY_ENCRYPTION_KEY;expect(()=>encryptSecret("x")).toThrow(CryptoConfigError);});
 it("signs and verifies bound state",()=>{const state=signState("user-a");expect(verifyState(state)).toBe("user-a");expect(verifyState(state,"user-a")).toBe("user-a");});
 it("rejects tampered state",()=>{const s=signState("u"), parts=s.split(".");parts[1]=parts[1].slice(0,-1)+(parts[1].endsWith("A")?"B":"A");expect(()=>verifyState(parts.join("."))).toThrow();});
 it("rejects expired state",()=>{vi.spyOn(Date,"now").mockReturnValue(1000);const s=signState("u");vi.spyOn(Date,"now").mockReturnValue(700000);expect(()=>verifyState(s)).toThrow();});
 it("rejects state user mismatch",()=>expect(()=>verifyState(signState("a"),"b")).toThrow());
});
