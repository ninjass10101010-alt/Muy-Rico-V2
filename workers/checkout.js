export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature, X-Webhook-Secret",
        },
      });
    }

    try {
      if (path === "/create-checkout" && request.method === "POST") {
        return await handleCreateCheckout(request, env);
      }
      if (path === "/paypal-client-id" && request.method === "GET") {
        return json({ clientId: env.PAYPAL_CLIENT_ID || "" });
      }
      if (path === "/webhook/stripe" && request.method === "POST") {
        return await handleStripeWebhook(request, env);
      }
      if (path === "/webhook/paypal" && request.method === "POST") {
        return await handlePayPalWebhook(request, env);
      }
      if (path === "/success" && request.method === "GET") {
        return successPage(url);
      }
      if (path === "/cancel" && request.method === "GET") {
        return cancelPage();
      }
      if (path === "/stripe-config" && request.method === "GET") {
        return json({ publishableKey: env.STRIPE_PUBLISHABLE_KEY || "" });
      }
      if (path === "/create-payment-intent" && request.method === "POST") {
        return await handleCreatePaymentIntent(request, env);
      }
      if (path === "/paypal/capture" && request.method === "POST") {
        return await handlePayPalCapture(request, env);
      }
    } catch (err) {
      console.error("checkout worker error:", err);
      return json({ error: String(err && err.message || err) }, 500);
    }

    return new Response("Not found", { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// Worker-to-worker: prefer the ORDERS_API service binding (direct, no edge hop,
// no 1042 block). Fall back to the public URL only if the binding is missing.
function ordersApiFetch(env, path, init = {}) {
  const headers = { ...(init.headers || {}), "X-Webhook-Secret": env.PAYMENT_WEBHOOK_SECRET || "" };
  if (env.ORDERS_API) {
    return env.ORDERS_API.fetch("https://orders-internal" + path, { ...init, headers });
  }
  const base = env.ORDERS_API_BASE || "https://muy-rico-orders-api.bexgarcia0208.workers.dev";
  return fetch(base + path, { ...init, headers });
}

async function handleCreateCheckout(request, env) {
  const { amount, items, origin, orderId } = await request.json();
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);

  const params = new URLSearchParams();
  params.append("line_items[0][price_data][currency]", "usd");
  params.append("line_items[0][price_data][product_data][name]", "Muy Rico Order");
  params.append("line_items[0][price_data][product_data][description]", items || "Bakery order");
  params.append("line_items[0][price_data][unit_amount]", String(amount));
  params.append("line_items[0][quantity]", "1");
  params.append("mode", "payment");
  if (orderId) {
    params.append("client_reference_id", String(orderId));
    params.append("metadata[order_id]", String(orderId));
  }
  const base = origin || "";
  params.append("success_url", base + "/order.html?paid=true&order=" + (orderId || ""));
  params.append("cancel_url", base + "/order.html?order=" + (orderId || ""));

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const session = await res.json();
  if (session.error) return json({ error: session.error.message }, 400);
  return json({ url: session.url });
}

async function handleStripeWebhook(request, env) {
  const sig = request.headers.get("Stripe-Signature") || "";
  const rawBody = await request.text();
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook secret not configured" }, 500);

  // Verify signature: t=<ts>,v1=<hmac>
  const parts = {};
  sig.split(",").forEach((p) => {
    const [k, v] = p.split("=");
    if (k && v !== undefined) parts[k] = v;
  });
  if (!parts.t || !parts.v1) return new Response("Invalid signature", { status: 400 });

  // Replay protection: reject signatures older than 5 minutes
  const TIMESTAMP_TOLERANCE = 300;
  const eventTime = parseInt(parts.t, 10);
  if (isNaN(eventTime) || Math.abs(Date.now() / 1000 - eventTime) > TIMESTAMP_TOLERANCE) {
    return new Response("Invalid signature", { status: 400 });
  }

  const signedPayload = parts.t + "." + rawBody;
  const expected = await hmacSha256(secret, signedPayload);
  const got = parts.v1;
  // constant-time compare
  let diff = expected.length ^ got.length;
  for (let i = 0; i < Math.max(expected.length, got.length); i++) {
    diff |= (expected[i] || "").charCodeAt(0) ^ (got[i] || "").charCodeAt(0);
  }
  if (diff !== 0) return new Response("Invalid signature", { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response("Bad JSON", { status: 400 }); }

  // Only reconcile completed checkout sessions
  if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
    const obj = event.data && event.data.object ? event.data.object : {};
    const orderId = event.type === "checkout.session.completed"
      ? (obj.client_reference_id || (obj.metadata && obj.metadata.order_id))
      : (obj.metadata && obj.metadata.order_id);
    if (!orderId) {
      console.warn(`stripe ${event.type} without order id — ignored`);
      return json({ received: true });
    }
    const ok = await markOrderPaidViaApi(orderId, "stripe", env);
    if (!ok) return json({ error: "mark-paid failed" }, 500);
  } else {
    // Acknowledge but ignore other event types (e.g. checkout.session.async_payment_*)
    console.log("stripe event ignored:", event.type);
  }

  return json({ received: true });
}

async function hmacSha256(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function markOrderPaidViaApi(orderId, method, env) {
  try {
    const res = await ordersApiFetch(env, "/api/orders/" + encodeURIComponent(orderId) + "/mark-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method }),
    });
    if (res.status === 404) {
      console.error("mark-paid 404 for order", orderId);
      return true; // don't retry; order missing
    }
    if (!res.ok) {
      console.error("mark-paid failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("mark-paid network error", e);
    return false;
  }
}

async function handlePayPalWebhook(request, env) {
  const body = await request.text();
  const headers = {
    authAlg: request.headers.get("PAYPAL-AUTH-ALGO") || "",
    certUrl: request.headers.get("PAYPAL-CERT-URL") || "",
    transmissionId: request.headers.get("PAYPAL-TRANSMISSION-ID") || "",
    transmissionSig: request.headers.get("PAYPAL-TRANSMISSION-SIG") || "",
    transmissionTime: request.headers.get("PAYPAL-TRANSMISSION-TIME") || "",
  };
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return json({ error: "PAYPAL_WEBHOOK_ID not configured" }, 500);

  // Parse early so a malformed body returns a clean 400 (not a 500 mid-verify)
  let event;
  try { event = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }

  // Get OAuth token
  const auth = await paypalAuth(env);
  if (!auth) return json({ error: "paypal auth failed" }, 500);

  const verifyRes = await fetch(env.PAYPAL_API_BASE + "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algorithm: headers.authAlg,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  const verify = await verifyRes.json();
  if (verify.verification_status !== "SUCCESS") {
    console.warn("paypal webhook verification failed:", verify.verification_status);
    return new Response("Invalid signature", { status: 400 });
  }

  const handled = ["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"];
  if (handled.includes(event.event_type)) {
    const resource = event.resource || {};
    const orderId =
      resource.custom_id ||
      (resource.purchase_units &&
        resource.purchase_units[0] &&
        resource.purchase_units[0].custom_id) ||
      (resource.supplementary_data &&
        resource.supplementary_data.related_ids &&
        resource.supplementary_data.related_ids.order_id);
    if (!orderId) {
      console.warn("paypal event without order id — ignored");
      return json({ received: true });
    }
    const ok = await markOrderPaidViaApi(orderId, "paypal", env);
    if (!ok) return json({ error: "mark-paid failed" }, 500);
  } else {
    console.log("paypal event ignored:", event.event_type);
  }

  return json({ received: true });
}

async function paypalAuth(env) {
  const basic = btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET);
  try {
    const res = await fetch(env.PAYPAL_API_BASE + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const j = await res.json();
    return j.access_token || null;
  } catch (e) {
    console.error("paypal auth error", e);
    return null;
  }
}

async function handleCreatePaymentIntent(request, env) {
  const body = await request.json();
  const orderId = body.orderId;
  if (!orderId) return json({ error: "orderId required" }, 400);

  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);

  const payableRes = await ordersApiFetch(env, "/api/orders/" + encodeURIComponent(orderId) + "/payable");

  if (!payableRes.ok) {
    console.error("payable lookup failed", payableRes.status);
    return json({ error: "Order not found or unavailable" }, payableRes.status);
  }

  const order = await payableRes.json();

  if (order.payment_status === 'paid') return json({ error: "Order already paid" }, 409);
  if (order.status !== 'awaiting_payment') return json({ error: "Order not in payable state" }, 409);

  const params = new URLSearchParams();
  params.append("amount", String(order.total_cents));
  params.append("currency", "usd");
  params.append("automatic_payment_methods[enabled]", "true");
  params.append("metadata[order_id]", String(orderId));
  params.append("metadata[source]", "website");
  if (order.email) params.append("receipt_email", order.email);

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const pi = await res.json();
  if (pi.error) return json({ error: pi.error.message }, 400);
  return json({ clientSecret: pi.client_secret });
}

async function handlePayPalCapture(request, env) {
  const body = await request.json();
  const { paypalOrderId, orderId } = body;
  if (!paypalOrderId || !orderId) return json({ error: "paypalOrderId and orderId required" }, 400);

  const payableRes = await ordersApiFetch(env, "/api/orders/" + encodeURIComponent(orderId) + "/payable");

  if (!payableRes.ok) {
    console.error("payable lookup failed", payableRes.status);
    return json({ error: "Order not found or unavailable" }, payableRes.status);
  }

  const order = await payableRes.json();
  if (order.payment_status === 'paid') return json({ error: "Order already paid" }, 409);
  if (order.status !== 'awaiting_payment') return json({ error: "Order not in payable state" }, 409);

  const auth = await paypalAuth(env);
  if (!auth) return json({ error: "paypal auth failed" }, 500);

  // Verify the PayPal order amount matches D1 BEFORE capturing any funds
  const orderRes = await fetch(env.PAYPAL_API_BASE + "/v2/checkout/orders/" + encodeURIComponent(paypalOrderId), {
    headers: { Authorization: "Bearer " + auth },
  });
  const paypalOrder = await orderRes.json();
  if (!orderRes.ok) {
    console.error("paypal order lookup failed", JSON.stringify(paypalOrder));
    return json({ error: "Could not verify PayPal order" }, 400);
  }
  const ppCents = Math.round(parseFloat(paypalOrder.purchase_units?.[0]?.amount?.value || "0") * 100);
  if (ppCents !== order.total_cents) {
    console.error(`paypal amount mismatch — refusing capture: D1=${order.total_cents}, paypal=${ppCents}, order=${orderId}`);
    return json({ error: "Amount mismatch" }, 400);
  }
  // Also confirm the PayPal order is linked to this Muy Rico order
  const ppCustomId = paypalOrder.purchase_units?.[0]?.custom_id || "";
  if (ppCustomId && ppCustomId !== String(orderId)) {
    console.error(`paypal custom_id mismatch: ${ppCustomId} != ${orderId}`);
    return json({ error: "Order mismatch" }, 400);
  }

  const captureRes = await fetch(env.PAYPAL_API_BASE + "/v2/checkout/orders/" + encodeURIComponent(paypalOrderId) + "/capture", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + auth,
      "Content-Type": "application/json",
    },
  });
  const captureData = await captureRes.json();

  if (!captureRes.ok || captureData.status !== "COMPLETED") {
    console.error("paypal capture failed", JSON.stringify(captureData));
    return json({ error: captureData.message || "Capture failed" }, 400);
  }

  const ok = await markOrderPaidViaApi(orderId, "paypal", env);
  if (!ok) return json({ error: "mark-paid failed" }, 500);

  return json({ ok: true });
}

function successPage(url) {
  const token = url.searchParams.get("token") || "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Complete — Muy Rico</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#faf7f2;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;color:#333}
  .card{background:#fff;padding:48px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center;max-width:400px}
  h1{font-size:28px;margin:0 0 8px;color:#2d7a46}
  p{color:#666;margin:8px 0;line-height:1.5}
  .btn{display:inline-block;margin-top:24px;padding:12px 32px;background:#2d7a46;color:#fff;text-decoration:none;border-radius:8px}
</style></head>
<body>
<div class="card">
  <h1>Payment Complete</h1>
  <p>Your order has been placed and your payment was successful.</p>
  <p style="font-size:14px;color:#999">PayPal Ref: ${token.slice(0,12)}…</p>
  <a class="btn" href="https://muy-rico.bexgarcia0208.workers.dev">Back to Muy Rico</a>
</div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

function cancelPage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment Cancelled — Muy Rico</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#faf7f2;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;color:#333}
  .card{background:#fff;padding:48px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center;max-width:400px}
  h1{font-size:28px;margin:0 0 8px;color:#c0392b}
  p{color:#666;margin:8px 0;line-height:1.5}
  .btn{display:inline-block;margin-top:24px;padding:12px 32px;background:#2d7a46;color:#fff;text-decoration:none;border-radius:8px}
</style></head>
<body>
<div class="card">
  <h1>Payment Cancelled</h1>
  <p>Your payment was not completed. You can try again whenever you're ready.</p>
  <a class="btn" href="https://muy-rico.bexgarcia0208.workers.dev">Back to Muy Rico</a>
</div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}
