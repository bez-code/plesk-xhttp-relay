import http from "node:http";

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(204, {
      "cache-control": "no-store"
    });
    res.end();
    return;
  }

  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end("node is running");
});

server.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});
