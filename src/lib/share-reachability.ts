/**
 * Reachability classification for share links.
 *
 * Tallyhand is local-first: the app may run on localhost, on a machine on the
 * local network, or on a publicly reachable host. A share link is only useful
 * to someone whose browser can actually reach this server, so the share UI
 * uses this classifier (over `window.location.hostname`) to say honestly who
 * the link will work for.
 *
 * Pure and dependency-free so it is trivially testable.
 */

/** Who can open a link served from this host. */
export type ShareReachability =
  /** Only browsers on this same device (loopback). */
  | "device"
  /** Devices on the same local network (private/LAN addresses, mDNS). */
  | "lan"
  /** Anyone on the internet. */
  | "internet";

function isLoopbackIpv4(host: string): boolean {
  const parts = host.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  if (!parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return false;
  const [a, b] = parts.map(Number);
  return (
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) // 169.254.0.0/16 link-local: same physical link
  );
}

function isPrivateIpv6(host: string): boolean {
  // Unique-local fc00::/7 (first 7 bits 1111 110 → "fc" or "fd") and
  // link-local fe80::/10 (first hextet fe80–febf).
  return (
    /^(fc|fd)[0-9a-f]{0,2}:/.test(host) ||
    /^fe[89ab][0-9a-f]{0,2}:/.test(host)
  );
}

/**
 * Classify who can reach a server running on `hostname`.
 *
 * Accepts what `window.location.hostname` provides, but also tolerates
 * "host:port" and bracketed IPv6 ("[::1]", "[::1]:3000") for tests/manual use.
 * Empty or unparseable input classifies as "device" — the conservative choice
 * (a link that only works locally is the honest default).
 */
export function classifyHostReachability(raw: string): ShareReachability {
  let host = raw.trim().toLowerCase();
  if (!host) return "device";

  // Strip brackets: "[::1]" / "[::1]:3000" → "::1" / "::1:3000"…
  if (host.startsWith("[") && host.includes("]")) {
    host = host.slice(1, host.indexOf("]"));
  }

  // Strip a trailing ":port" — but only when there is exactly one colon, so
  // bare IPv6 literals ("fe80::1") are left alone.
  const colonCount = (host.match(/:/g) ?? []).length;
  if (colonCount === 1 && /:\d+$/.test(host)) {
    host = host.slice(0, host.lastIndexOf(":"));
  }

  if (host === "0.0.0.0") return "device";
  if (host === "localhost" || host === "localhost.localdomain") return "device";
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "device";
  if (isLoopbackIpv4(host)) return "device";

  // IPv4-mapped IPv6 ("::ffff:192.168.1.10") — classify by the embedded IPv4.
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    if (isLoopbackIpv4(mapped[1])) return "device";
    if (isPrivateIpv4(mapped[1])) return "lan";
    return "internet";
  }

  if (host.endsWith(".local") || host === "local") return "lan";
  if (isPrivateIpv4(host)) return "lan";
  if (host.includes(":") && isPrivateIpv6(host)) return "lan";

  // Single-label names ("tallyhand", "myserver") are intranet/mDNS-style
  // names, not public DNS — treat as LAN.
  if (!host.includes(".") && !host.includes(":")) return "lan";

  return "internet";
}
