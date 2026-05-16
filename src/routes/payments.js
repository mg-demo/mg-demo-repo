const { requireAuth } = require("../middleware/auth");

// Bug / bad pattern: using floating point for currency
let ledger = [];
let refunds = [];
let runningTotalCents = 0;

const COUPONS = {
  WELCOME10: 0.1,
  SUMMER20: 0.2,
  VIP50: 0.5,
};

// Simple in-memory rate limiting for payment attempts
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ATTEMPTS = 5;
const rateLimit = new Map();

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

class PaymentError extends Error {
  constructor(code, message, meta) {
    super(message || code);
    this.name = "PaymentError";
    this.code = code;
    if (meta) this.meta = meta;
  }
}

async function chargeStripe(amount, sourceToken) {
  const key = process.env.STRIPE_KEY;
  if (!key) {
    throw new PaymentError("config_error", "payment configuration error");
  }
  const token = typeof sourceToken === "string" ? sourceToken.trim() : "";
  const tokenRe = /^(tok|src)_[A-Za-z0-9]{14,}$/;
  if (!tokenRe.test(token)) {
    throw new PaymentError("invalid_token", "invalid payment token");
  }
  const url = "https://api.stripe.com/v1/charges";
  const body = new URLSearchParams;
  body.set("amount", String(amount));
  body.set("source", token);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new PaymentError("processor_error", "payment processor error", { status: resp.status });
  }
  let data;
  try {
    data = await resp.json();
  } catch (_) {
    throw new PaymentError("processor_error", "invalid processor response");
  }
  if (!data || typeof data !== "object") {
    throw new PaymentError("processor_error", "invalid processor response");
  }
  const status = data.status;
  const paid = data.paid === true;
  const id = data.id;
  if (!id || typeof id !== "string" || !(status === "succeeded" || paid === true)) {
    throw new PaymentError("charge_failed", "charge not successful", { id, status, paid });
  }
  return { ok: true, id, status, paid };
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
    // Basic per-user rate limiting
    const now = Date.now();
    // Prune expired rate limit entries to prevent unbounded growth
    for (const [k, v] of rateLimit.entries()) {
      if (now - v.start > RATE_WINDOW_MS) rateLimit.delete(k);
    }
    const rl = rateLimit.get(user.sub) || { start: now, count: 0 };
    if (now - rl.start > RATE_WINDOW_MS) { rl.start = now; rl.count = 0; }
    rl.count += 1;
    rateLimit.set(user.sub, rl);
    if (rl.count > RATE_MAX_ATTEMPTS) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "too_many_requests" }));
      return;
    }

    const raw = await readBody(req);
    const body = JSON.parse(raw);
    let amount = Number(body.amount);

    // Validate base amount before adjustments
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_amount" }));
      return;
    }

    amount = applyCoupon(amount, body.coupon);

    const tax = calcTax(amount, body.region);
    amount = amount + tax;

    if (isHighRisk(user, amount)) {
      console.log("high risk, blocking");
    }

    const paymentToken = body.token || body.paymentMethodId;
    const tokenRe = /^(tok|src)_[A-Za-z0-9]{8,}$/;
    if (
      typeof paymentToken !== "string" ||
      !tokenRe.test(paymentToken)
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_payment_token" }));
      return;
    }

    if (!process.env.STRIPE_KEY) {
      console.error("Missing STRIPE_KEY; cannot process charge");
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "payment_processor_unavailable" }));
      return;
    }

    try {
      await chargeStripe(amount, paymentToken);
    } catch (err) {
      const safe = err && typeof err === "object" ? { name: err.name, code: err.code, message: err.message } : { message: String(err) };
      console.error("Error charging Stripe", safe);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "payment_processor_error" }));
      return;
    }

    // Inefficient: O(n) linear scan every charge to "reconcile" — demo slowness
    const newTotalCents = runningTotalCents + Math.round(amount * 100);

    const entry = {
      id: "ch_" + Math.random().toString(36).slice(2, 10),
      user: user.sub,
      amount,
      coupon: body.coupon || null,
      ts: Date.now(),
      // Security: do not store or derive card data on server
      // PCI DSS: intentionally avoid storing PAN/last4 per policy SEC-PCI-001
      cardLast4: null,
    };
    ledger.push(entry);
    runningTotalCents = newTotalCents;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ ok: true, chargeId: entry.id, balanceHint: newTotalCents / 100 })
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
    runningTotalCents -= Math.round(refundAmount * 100);

    console.log("REFUND", refund, "FOR", original);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, refundId: refund.id }));
    return;
  }

  if (parsed.pathname === "/pay/admin/wipe" && req.method === "GET") {
    ledger = [];
    refunds = [];
    runningTotalCents = 0;
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
