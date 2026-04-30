import http from "node:http";
import https from "node:https";

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const PORT = process.env.PORT || 3000;

const STRIP_REQ_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "content-length"
]);

const STRIP_RES_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function copyRequestHeaders(headers, req) {
  const out = {};

  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (STRIP_REQ_HEADERS.has(k)) continue;
    out[key] = value;
  }

  const clientIp =
    headers["x-real-ip"] ||
    headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "";

  if (clientIp) {
    out["x-forwarded-for"] = clientIp;
  }

  return out;
}

function copyResponseHeaders(headers) {
  const out = {};

  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (STRIP_RES_HEADERS.has(k)) continue;
    out[key] = value;
  }

  out["cache-control"] = "no-store";
  return out;
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(text);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(204, {
      "cache-control": "no-store"
    });
    res.end();
    return;
  }

  if (!TARGET_BASE) {
    sendText(res, 500, "Misconfigured: TARGET_DOMAIN is not set");
    return;
  }

  if (!req.url.startsWith("/api/v1/score")) {
    sendText(res, 404, "Not Found");
    return;
  }

  let target;

  try {
    target = new URL(TARGET_BASE + req.url);
  } catch {
    sendText(res, 500, "Invalid TARGET_DOMAIN");
    return;
  }

  const upstreamModule = target.protocol === "https:" ? https : http;

  const upstreamReq = upstreamModule.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: target.pathname + target.search,
      headers: copyRequestHeaders(req.headers, req),
      timeout: 0
    },
    (upstreamRes) => {
      res.writeHead(
        upstreamRes.statusCode || 502,
        copyResponseHeaders(upstreamRes.headers)
      );

      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", (err) => {
    console.error("relay error:", err);

    if (!res.headersSent) {
      sendText(res, 502, "Bad Gateway: Tunnel Failed");
      return;
    }

    res.destroy(err);
  });

  req.on("aborted", () => {
    upstreamReq.destroy();
  });

  res.on("close", () => {
    upstreamReq.destroy();
  });

  req.pipe(upstreamReq);
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;

server.listen(PORT, () => {
  console.log(`XHTTP relay listening on port ${PORT}`);
  console.log(`TARGET_DOMAIN=${TARGET_BASE}`);
});
