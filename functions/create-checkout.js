export async function onRequestGet() {
  return new Response("✅ Checkout function is deployed.", {
    headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const { amount, items, origin } = await request.json();
    const key = env.STRIPE_SECRET_KEY;

    if (!key) {
      return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY not set in Cloudflare environment variables" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const params = new URLSearchParams();
    params.append("line_items[0][price_data][currency]", "usd");
    params.append("line_items[0][price_data][product_data][name]", "Muy Rico Order");
    params.append("line_items[0][price_data][product_data][description]", items || "Bakery order");
    params.append("line_items[0][price_data][unit_amount]", String(amount));
    params.append("line_items[0][quantity]", "1");
    params.append("mode", "payment");
    params.append("success_url", (origin || "") + "/order.html?paid=true");
    params.append("cancel_url", (origin || "") + "/order.html");

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const session = await res.json();

    if (session.error) {
      return new Response(JSON.stringify({ error: session.error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
