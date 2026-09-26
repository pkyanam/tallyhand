import { describe, expect, it } from "vitest";
import { classifyHostReachability } from "./share-reachability";

describe("classifyHostReachability", () => {
  it.each([
    ["localhost", "device"],
    ["LOCALHOST", "device"],
    ["localhost:3000", "device"],
    ["localhost.localdomain", "device"],
    ["127.0.0.1", "device"],
    ["127.0.0.1:3000", "device"],
    ["127.1.2.3", "device"],
    ["::1", "device"],
    ["[::1]", "device"],
    ["[::1]:3000", "device"],
    ["0.0.0.0", "device"],
    ["", "device"],
    ["   ", "device"],
  ])("classifies %s as device-only", (host, expected) => {
    expect(classifyHostReachability(host)).toBe(expected);
  });

  it.each([
    ["192.168.1.5", "lan"],
    ["192.168.0.1:3000", "lan"],
    ["10.0.0.2", "lan"],
    ["10.255.255.255", "lan"],
    ["172.16.0.1", "lan"],
    ["172.31.255.254", "lan"],
    ["169.254.10.20", "lan"],
    ["myserver.local", "lan"],
    ["tallyhand.local:3000", "lan"],
    ["myserver", "lan"],
    ["fc00::1", "lan"],
    ["fd12:3456::1", "lan"],
    ["fe80::1", "lan"],
    ["::ffff:192.168.1.10", "lan"],
    ["::ffff:127.0.0.1", "device"],
  ])("classifies %s as local network", (host, expected) => {
    expect(classifyHostReachability(host)).toBe(expected);
  });

  it.each([
    ["example.com", "internet"],
    ["app.tallyhand.com", "internet"],
    ["8.8.8.8", "internet"],
    ["172.15.0.1", "internet"],
    ["172.32.0.1", "internet"],
    ["11.0.0.1", "internet"],
    ["2001:db8::1", "internet"],
    ["::ffff:8.8.8.8", "internet"],
  ])("classifies %s as internet-reachable", (host, expected) => {
    expect(classifyHostReachability(host)).toBe(expected);
  });

  it("does not mistake 172.15.x / 172.32.x for the 172.16/12 private range", () => {
    expect(classifyHostReachability("172.15.255.255")).toBe("internet");
    expect(classifyHostReachability("172.32.0.0")).toBe("internet");
  });
});
