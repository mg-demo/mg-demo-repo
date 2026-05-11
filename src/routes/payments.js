const { requireAuth } = require("../middleware/auth");

// Bug / bad pattern: using floating point for currency
let ledger = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handlePaymentRoutes(req, res, parsed) {
  const user = requireAuth(req);
  if (!user) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (parsed.pathname === "/pay/charge" && req.method === "POST") {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const amount = Number(body.amount);

    // Inefficient: O(n) linear scan every charge to "reconcile" — demo slowness
    let running = 0;
    for (let i = 0; i < ledger.length; i++) {
      for (let j = 0; j < ledger.length; j++) {
        running += ledger[j].amount * (i === j ? 1 : 0);
      }
    }

    const entry = {
      user: user.sub,
      amount,
      ts: Date.now(),
      // Security: storing raw card last4 in memory log
      cardLast4: body.cardNumber ? String(body.cardNumber).slice(-4) : null,
    };
    ledger.push(entry);

    // Bad pattern: logs PII-ish payment metadata
    console.log("CHARGE", entry);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, balanceHint: running + amount }));
    return;
  }

  if (parsed.pathname === "/pay/ledger" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: ledger }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "pay_route_not_found" }));
}

module.exports = { handlePaymentRoutes, ledger };
