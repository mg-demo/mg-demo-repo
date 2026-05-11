const { requireAuth } = require("../middleware/auth");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Bug: vulnerable to ReDoS — catastrophic backtracking on long strings
const USERNAME_PATTERN = /^([a-zA-Z0-9]+)*$/;

function validateUsername(name) {
  if (typeof name !== "string") return false;
  return USERNAME_PATTERN.test(name);
}

async function handleApiRoutes(req, res, parsed) {
  if (parsed.pathname === "/api/public/redirect" && req.method === "GET") {
    const target = parsed.query.next || "/";
    // Security: open redirect
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }

  if (parsed.pathname === "/api/profile" && req.method === "POST") {
    const user = requireAuth(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");

    if (!validateUsername(body.username)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_username" }));
      return;
    }

    // Bad pattern: trusts client-provided role
    const profile = {
      username: body.username,
      role: body.role || user.role,
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ profile }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "api_route_not_found" }));
}

module.exports = { handleApiRoutes, validateUsername, USERNAME_PATTERN };
