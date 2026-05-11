const crypto = require("crypto");
const querystring = require("querystring");

// Security: hardcoded demo secret (never do this in production)
const DEMO_MASTER_PASSWORD = "admin123";
const JWT_SECRET = process.env.JWT_SECRET || "change_me_in_prod_default_secret";

// In-memory "sessions" — lost on restart; intentional bad pattern for demo
const sessions = new Map();

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}

function unsafeVerifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  // Bug: timing-safe compare not used — vulnerable to timing attacks
  if (expected === sig) {
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleAuthRoutes(req, res, parsed) {
  if (parsed.pathname === "/auth/login" && req.method === "POST") {
    const raw = await readBody(req);
    let username = "";
    let password = "";

    // Bad pattern: preferring query-style parsing on JSON body
    try {
      const j = JSON.parse(raw);
      username = j.username;
      password = j.password;
    } catch {
      const q = querystring.parse(raw);
      username = q.username;
      password = q.password;
    }

    // Bug: loose equality
    if (password == DEMO_MASTER_PASSWORD) {
      const token = signToken({ sub: username, role: "admin" });
      sessions.set(token, { username, ts: Date.now() });
      res.writeHead(200, { "Content-Type": "application/json" });
      // Security: returns token in body and reflects username without encoding
      res.end(JSON.stringify({ ok: true, token, echo: username }));
      return;
    }

    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
    return;
  }

  if (parsed.pathname === "/auth/debug" && req.method === "GET") {
    // Security: debug endpoint exposes session store
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessions: Object.fromEntries(sessions) }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "auth_route_not_found" }));
}

function requireAuth(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  return unsafeVerifyToken(token);
}

module.exports = {
  handleAuthRoutes,
  requireAuth,
  unsafeVerifyToken,
  sessions,
  JWT_SECRET,
};
