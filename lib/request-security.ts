/** Browser write requests must come from this service or an explicitly allowed origin. */
export type SecurityRequest = Pick<Request, "method" | "url" | "headers">;

export function isAllowedWriteRequest(
  request: SecurityRequest,
  allowedOrigins = process.env.APP_ALLOWED_ORIGINS ?? "",
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;

  const rawOrigin = request.headers.get("origin");
  const rawReferer = rawOrigin === null ? request.headers.get("referer") : null;
  if (rawOrigin === null && rawReferer === null) {
    // Non-browser clients are supported; cross-site browser requests are not.
    return request.headers.get("sec-fetch-site") !== "cross-site";
  }

  try {
    const source = rawOrigin ?? rawReferer!;
    const origin = new URL(source);
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) return false;
    // Origin contains only the serialized origin; Referer may include a path.
    if (rawOrigin !== null && origin.origin !== rawOrigin) return false;
    if (source.trim() !== source) return false;
    const trustedOrigins = allowedOrigins.split(",").map((value) => value.trim()).filter(Boolean);
    if (trustedOrigins.includes(origin.origin)) return true;
    if (request.headers.get("sec-fetch-site") === "cross-site") return false;

    const requestUrl = new URL(request.url);
    const host = request.headers.get("host") ?? requestUrl.host;
    // Use the actual request protocol. TLS-terminating proxies must explicitly
    // configure their public HTTPS origin in APP_ALLOWED_ORIGINS.
    if (!["http:", "https:"].includes(requestUrl.protocol) || !host || /[\s/\\?#@]/.test(host)) return false;
    const target = new URL(`${requestUrl.protocol}//${host}`);
    return origin.origin === target.origin;
  } catch {
    return false;
  }
}

/** SQLite string literals escape apostrophes by doubling them. */
export function sqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
