import assert from "assert/strict";
import { isAllowedWriteRequest, sqliteStringLiteral } from "../lib/request-security";

function request(method: string, headers: Record<string, string> = {}, url = "http://localhost:3000/api/work-items") {
  return {
    method,
    url,
    headers: { get: (name: string) => headers[name] ?? null } as Headers,
  };
}

export function runSecurityTests() {
  // An unrelated process environment must not change these security assertions.
  const allowed = (value: ReturnType<typeof request>, origins = "") => isAllowedWriteRequest(value, origins);
  for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
    assert.equal(allowed(request(method, { origin: "https://untrusted.example", "sec-fetch-site": "cross-site" })), true);
  }
  assert.equal(allowed(request("POST")), true, "CLI requests remain supported");
  assert.equal(allowed(request("DELETE", { "sec-fetch-site": "cross-site" })), false);
  assert.equal(allowed(request("PATCH", { origin: "http://localhost:3000" })), true);
  assert.equal(allowed(request("POST", { origin: "https://localhost:3000" })), false, "Scheme is part of the origin");
  assert.equal(allowed(request("POST", { origin: "http://localhost:3001" })), false, "Port is part of the origin");
  assert.equal(allowed(request("POST", { origin: "https://evil.example" })), false);
  assert.equal(allowed(request("POST", { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" })), false);
  for (const origin of ["", "null", "http://localhost:3000/path", "http://localhost:3000/", "http://localhost:3000?query=1", "ftp://localhost:3000", "http://user@localhost:3000", " http://localhost:3000"]) {
    assert.equal(allowed(request("POST", { origin })), false, `Reject malformed Origin: ${origin}`);
  }

  assert.equal(allowed(request("POST", { origin: "http://public.example:8080", host: "public.example:8080" })), true, "Host supplies the target authority");
  assert.equal(allowed(request("POST", { origin: "http://public.example:8080", host: "public.example:8081" })), false);
  assert.equal(allowed(request("POST", { origin: "http://public.example", host: "PUBLIC.EXAMPLE" })), true, "Host names are case insensitive");
  assert.equal(allowed(request("POST", { origin: "http://public.example", host: "public.example:80" })), true, "Default ports identify the same origin");
  assert.equal(allowed(request("POST", { origin: "http://[::1]:3000", host: "[::1]:3000" })), true);
  for (const host of ["", "public.example/path", "public.example?query=1", "public.example#fragment", "user@public.example", "public.example\\path", "public.example:bad", " public.example"]) {
    assert.equal(allowed(request("POST", { origin: "http://public.example", host })), false, `Reject malformed Host: ${host}`);
  }

  const proxyRequest = request("POST", { origin: "https://public.example", host: "public.example" });
  assert.equal(allowed(proxyRequest), false, "An HTTP backend does not implicitly trust the HTTPS scheme");
  assert.equal(allowed(proxyRequest, "https://public.example"), true, "A TLS proxy must configure its public origin");
  assert.equal(allowed(proxyRequest, "https://public.example.evil.test"), false, "Allowlist entries match exactly");
  assert.equal(allowed(request("POST", { origin: "https://public.example", "sec-fetch-site": "cross-site" }), " https://other.example, https://public.example "), true);
  assert.equal(allowed(request("POST", { origin: "https://public.example", host: "public.example" }, "https://internal.example/api/work-items")), true);
  assert.equal(allowed(request("POST", { origin: "https://public.example", host: "public.example", "x-forwarded-proto": "https" })), false, "Forwarded headers do not replace explicit proxy configuration");

  assert.equal(allowed(request("POST", { referer: "http://localhost:3000/work-items?view=all" })), true);
  assert.equal(allowed(request("POST", { referer: "https://localhost:3000/work-items" })), false);
  assert.equal(allowed(request("POST", { referer: "http://evil.example/work-items", "sec-fetch-site": "same-origin" })), false, "Foreign Referer is rejected when Origin is absent");
  assert.equal(allowed(request("POST", { referer: "http://localhost:3000/work-items", "sec-fetch-site": "cross-site" })), false);
  assert.equal(allowed(request("POST", { referer: "https://public.example/work-items" }), "https://public.example"), true);
  for (const referer of ["", "not a URL", "ftp://localhost:3000/work-items", "http://user@localhost:3000/work-items"]) {
    assert.equal(allowed(request("POST", { referer })), false, `Reject malformed Referer: ${referer}`);
  }
  assert.equal(allowed(request("POST", { origin: "null", referer: "http://localhost:3000/work-items" })), false, "Referer cannot override an invalid Origin");
  assert.equal(sqliteStringLiteral("/tmp/team's db.db"), "'/tmp/team''s db.db'");
}
