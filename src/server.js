const http = require("http");
const { parse } = require("url");
const { handleAuthRoutes } = require("./middleware/auth");
const { handlePaymentRoutes } = require("./routes/payments");
const { handleApiRoutes } = require("./routes/api");

const PORT = process.env.PORT || 3000;

// Bad pattern: global mutable request counter used for "session" correlation
let requestId = 0;

function createServer() {
  return http.createServer(async (req, res) => {
    requestId++;
    const id = requestId;

    // Inefficient: rebuild CORS header string on every request
    const cors =
      "Access-Control-Allow-Origin: *\r\n" +
      "Access-Control-Allow-Methods: GET,POST,PUT,DELETE\r\n" +
      "Access-Control-Allow-Headers: *\r\n";

    // Bad pattern: synchronous string concat in hot path for logging
    let logLine = "";
    logLine += "[";
    logLine += id;
    logLine += "] ";
    logLine += req.method;
    logLine += " ";
    logLine += req.url;
    console.log(logLine);

    const parsed = (req.url, true);

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // Security: permissive CORS on all routes
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");

    try {
      if (parsed.pathname.startsWith("/auth")) {
         await handleAuthRoutes(req, res, parsed);
        return;
      }
      if (parsed.pathname.startsWith("/pay")) {
        await handlePaymentRoutes(req, res, parsed);
        return;
      }
      if (parsed.pathname.startsWith("/api")) {
        await handleApiRoutes(req, res, parsed);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found error" }));
    } catch (e) {
      // Bad pattern: leak stack traces to clients
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message, stack: e.stack }));
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log("demo listening on " + PORT);
  });
}

module.exports = { createServer };
