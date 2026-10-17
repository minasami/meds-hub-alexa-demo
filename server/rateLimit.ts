import { isIP } from "node:net";

export type ProxyRoute = "tool" | "initialize";
export function normalizeIp(value: string | null | undefined): string {
  const ip = value?.trim() || "";
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6) return new URL(`http://[${ip}]`).hostname.toLowerCase();
  return "unknown"; // Missing/malformed IPs share a bucket, never receive a bypass.
}

// Trust this header only inside Vercel, whose ingress overwrites it.
// Self-hosted middleware uses socket.remoteAddress instead of client-supplied headers.
export function vercelClientIp(request: Request): string {
  if (process.env.VERCEL !== "1") return normalizeIp(null);
  const realIp = request.headers.get("x-real-ip")?.trim();
  const firstHop = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return normalizeIp(realIp || firstHop);
}

export function createIpRateLimiter({ windowMs = 60_000, toolLimit = 30, initializeLimit = 6, maxEntries = 10_000, now = Date.now } = {}) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (ip: string, route: ProxyRoute): { allowed: boolean; retryAfter: number } => {
    const time = now(), key = `${route}:${normalizeIp(ip.replace(/^\[|\]$/g, ""))}`;
    let bucket = buckets.get(key);
    if (bucket && time >= bucket.resetAt) { buckets.delete(key); bucket = undefined; }
    if (!bucket) {
      if (buckets.size >= maxEntries) {
        for (const [k, b] of buckets) if (time >= b.resetAt) buckets.delete(k);
        // Bound memory without evicting active counters (which would reset attackers' quotas).
        if (buckets.size >= maxEntries) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
      }
      bucket = { count: 0, resetAt: time + windowMs }; buckets.set(key, bucket);
    }
    if (bucket.count >= (route === "tool" ? toolLimit : initializeLimit))
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)) };
    bucket.count++;
    return { allowed: true, retryAfter: 0 };
  };
}
