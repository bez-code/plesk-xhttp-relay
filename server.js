import http from "node:http";
import https from "node:https";

const TARGET_BASE = "http://213.142.148.52";
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
  "x-forwarded-port"
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

function debugOrigin(res) {
const testUrl = "http://213.142.148.52/api/v1/score";
  const testReq = http.request(
    testUrl,
    {
      method: "GET",
      timeout: 15000
    },
    (testRes) => {
      let body = "";

      testRes.on("data", (chunk) => {
        body += chunk.toString();
      });

      testRes.on("end", () => {
        sendText(
          res,
          200,
          [
            `origin status=${testRes.statusCode}`,
            `headers=${JSON.stringify(testRes.headers)}`,
            `body=${body}`
          ].join("\n")
        );
      });
    }
  );

  testReq.on("timeout", () => {
    testReq.destroy(new Error("origin timeout"));
  });

  testReq.on("error", (err) => {
    sendText(
      res,
      502,
      [
        "origin error",
        `code=${err.code || "NO_CODE"}`,
        `message=${err.message}`
      ].join("\n")
    );
  });

  testReq.end();
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    sendText(res, 200, "health ok");
    return;
  }

  if (req.url === "/debug-origin") {
    debugOrigin(res);
    return;
  }
  if (req.url === "/debug-targets") {
  const targets = [
    "http://213.142.148.52/health",
    "http://example.com/",
    "http://github.com/",
    "https://github.com/",
    "https://www.npmjs.com/",
    "https://react.dev/",
    "https://nextjs.org/"
  ];

  const results = [];

  async function testTarget(url) {
    return new Promise((resolve) => {
      const lib = url.startsWith("https:") ? https : http;
      const started = Date.now();

      const r = lib.request(url, { method: "GET", timeout: 10000 }, (rr) => {
        rr.resume();
        rr.on("end", () => {
          resolve({
            url,
            status: rr.statusCode,
            ms: Date.now() - started
          });
        });
      });

      r.on("timeout", () => {
        r.destroy(new Error("timeout"));
      });

      r.on("error", (err) => {
        resolve({
          url,
          error: err.code || "NO_CODE",
          message: err.message,
          ms: Date.now() - started
        });
      });

      r.end();
    });
  }

  Promise.all(targets.map(testTarget)).then((items) => {
    sendText(res, 200, JSON.stringify(items, null, 2));
  });

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
    sendText(res, 500, "Invalid target URL");
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
      sendText(
        res,
        502,
        [
          "Bad Gateway: Tunnel Failed",
          `code=${err.code || "NO_CODE"}`,
          `message=${err.message}`
        ].join("\n")
      );
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
  console.log(`TARGET_BASE=${TARGET_BASE}`);
});
