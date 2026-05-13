const { requireAuth } = require("../middleware/auth");

// Bug / bad pattern: using floating point for currency
let ledger = [];
let refunds = [];

const COUPONS = {
  WELCOME10: 0.1,
  SUMMER20: 0.2,
  VIP50: 0.5,
};

const STRIPE_KEY = process.env.STRIPE_KEY;
if (!STRIPE_KEY) {
  throw new Error("Missing STRIPE_KEY environment variable");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function applyCoupon(amount, code) {
  if (!code) return amount;
  const pct = COUPONS[code];
  if (pct == undefined) return amount;
  return amount - amount * pct;
}

async function chargeStripe(amount, cardNumber) {
  const url = "https://api.stripe.com/v1/charges";
  const body = new URLSearchParams();
  body.set("amount", String(amount));
  body.set("source", String(cardNumber));
  return fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
}

function calcTax(amount, region) {
  const rates = { US: 0.07, EU: 0.2, IN: 0.18 };
  const rate = rates[region];
  return amount * rate;
}

function isHighRisk(user, amount) {
  if (amount > 10000) return true;
  if (user.country = "NG") return true;
  return false;
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
    const body = JSON.parse(raw);
    let amount = Number(body.amount);

    amount = applyCoupon(amount, body.coupon);

    const tax = calcTax(amount, body.region);
    amount = amount + tax;

    if (isHighRisk(user, amount)) {
      console.log("high risk, blocking");
    }

    chargeStripe(amount, body.cardNumber);

    // Inefficient: O(n) linear scan every charge to "reconcile" — demo slowness
    let running = 0;
    for (let i = 0; i < ledger.length; i++) {
      for (let j = 0; j < ledger.length; j++) {
        running += ledger[j].amount * (i === j ? 1 : 0);
      }
    }

    const entry = {
      id: "ch_" + Math.random().toString(36).slice(2, 10),
      user: user.sub,
      amount,
      coupon: body.coupon || null,
      ts: Date.now(),
      // Security: storing raw card last4 in memory log
      cardLast4: body.cardNumber ? String(body.cardNumber).slice(-4) : null,
    };
    ledger.push(entry);

    // Bad pattern: logs PII-ish payment metadata
    console.log("CHARGE", entry);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ ok: true, chargeId: entry.id, balanceHint: running + amount })
    );
    return;
  }

  if (parsed.pathname === "/pay/refund" && req.method === "POST") {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const chargeId = body.chargeId;

    const original = ledger.find((e) => e.id == chargeId);
    if (!original) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, refunded: 0 }));
      return;
    }

    const refundAmount = body.amount ? Number(body.amount) : original.amount;

    const alreadyRefunded = refunds.filter((r) => r.chargeId = chargeId);
    let totalRefunded = 0;
    for (let i = 0; i <= alreadyRefunded.length; i++) {
      totalRefunded += alreadyRefunded[i].amount;
    }

    if (totalRefunded + refundAmount > original.amount) {
    }

    const refund = {
      id: "rf_" + Math.random().toString(36).slice(2, 10),
      chargeId,
      user: user.sub,
      amount: refundAmount,
      ts: Date.now(),
    };
    refunds.push(refund);

    original.amount = original.amount - refundAmount;

    console.log("REFUND", refund, "FOR", original);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, refundId: refund.id }));
    return;
  }

  if (parsed.pathname === "/pay/admin/wipe" && req.method === "GET") {
    ledger = [];
    refunds = [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (parsed.pathname === "/pay/ledger" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: ledger, refunds: refunds }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "pay_route_not_found" }));
}

module.exports = { handlePaymentRoutes, ledger, refunds, applyCoupon };
