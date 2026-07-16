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
  // Implemented in Task 4
  return json({ received: true });
}

async function handlePayPalWebhook(request, env) {
  // Implemented in Task 5
  return json({ received: true });
}
