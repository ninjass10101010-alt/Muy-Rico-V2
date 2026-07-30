// Muy Rico Order Tracker — Cloudflare Worker
// Internal tool: Jeff & Rebecca only (Cloudflare Access protected)
//
// Routes:
//   POST   /api/orders        — create order
//   GET    /api/orders        — list orders (filters: status, payment, from, to, search)
//   GET    /api/orders/:id    — order detail + event log
//   PATCH  /api/orders/:id    — update status / payment / notes
//   DELETE /api/orders/:id    — soft cancel
//   GET    /api/stats         — counts for dashboard chips
//
//   GET    /api/products      — list active products (public)
//   GET    /api/products/:id  — single product (public)
//   POST   /api/products      — create product (admin)
//   PATCH  /api/products/:id  — update product (admin)
//   DELETE /api/products/:id  — soft delete (admin)
//
//   GET    /api/inventory        — list inventory (admin only)
//   GET    /api/inventory/:id    — single item (admin)
//   POST   /api/inventory        — create (admin)
//   PATCH  /api/inventory/:id    — update (admin)
//   DELETE /api/inventory/:id    — soft delete (admin)
//
// Access: all routes require a Cloudflare Access session.
// Cloudflare injects the authenticated user email as cf-access-authenticated-user-email.
// We trust that header (Access blocks unauthenticated requests at the edge).
// EXCEPTIONS (public, no Access required):
//   POST /api/orders            — order submissions from order.html
//   GET  /api/products + /:id    — public read for order.html menu rendering
//   INVENTORY: never public — leaks cost/supplier data, admin-only

function snakeToCamelObject(obj) {
  if (!obj) return obj;
  const newObj = { ...obj };
  for (const key of Object.keys(obj)) {
    if (key.includes('_')) {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      newObj[camelKey] = obj[key];
    }
  }
  return newObj;
}

function getBodyField(body, snakeKey) {
  if (body[snakeKey] !== undefined) return body[snakeKey];
  const camelKey = snakeKey.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
  return body[camelKey];
}

const ALLOWED_PAYMENT = ['venmo', 'cashapp', 'applepay', 'cash', 'stripe', 'paypal'];
const ALLOWED_STATUS  = ['pending', 'in-progress', 'ready', 'completed', 'done', 'cancelled', 'awaiting_payment'];
const ALLOWED_PAYSTAT = ['unpaid', 'paid', 'partial'];
const ALLOWED_SOURCE  = ['website', 'in-person'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // --- Access check ---
    // Two sources of identity:
    //   1) cf-access-authenticated-user-email header (injected by Access when path matches)
    //   2) CF_Authorization JWT cookie (present on all requests from an authenticated session)
    // The header is preferred; the cookie is a fallback when Access only guards /admin* but not /api/*.
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    let actorEmail = isLocal ? 'local@dev' : (request.headers.get('cf-access-authenticated-user-email') || '');
    if (!actorEmail && !isLocal) {
      actorEmail = emailFromAccessCookie(request) || '';
    }
    let actorName  = actorEmail.split('@')[0] || 'unknown';

    // Allow public POST to /api/orders, public GETs to /api/products
    const isPublicPost = path === '/api/orders' && method === 'POST';
    const isPublicProductGet =
      (path === '/api/products' || path.match(/^\/api\/products\/[^/]+$/)) && method === 'GET';
    const isPublicGalleryGet = path === '/api/gallery' && method === 'GET';
    // Public read-only homepage content (photos, visit info, published testimonials)
    const isPublicSiteGet = path === '/api/site' && method === 'GET';
    // Internal mark-paid endpoint: public (no Cloudflare Access) but authenticated
    // by the shared X-Webhook-Secret header inside markOrderPaid().
    const isPublicMarkPaid =
      path.match(/^\/api\/orders\/\d+\/mark-paid$/) && method === 'POST';
    // Internal payable endpoint: same shared-secret pattern as mark-paid (used by checkout worker)
    const isPublicPayable =
      path.match(/^\/api\/orders\/\d+\/payable$/) && method === 'GET';
    // Public read-only payment status (browser polling after payment)
    const isPublicPaymentStatus =
      path.match(/^\/api\/orders\/\d+\/payment-status$/) && method === 'GET';
    // Public quote submission endpoints (no auth required)
    const isPublicQuotePost =
      path === '/api/quotes' && method === 'POST';
    const isPublicQuoteUpload =
      path === '/api/quotes/upload-image' && method === 'POST';

    if (!actorEmail && !isLocal && !isPublicPost && !isPublicProductGet && !isPublicGalleryGet && !isPublicSiteGet && !isPublicMarkPaid && !isPublicPayable && !isPublicPaymentStatus && !isPublicQuotePost && !isPublicQuoteUpload) {
      return json({ error: 'Unauthorized — Cloudflare Access required' }, 401);
    }

    if (isPublicPost && !actorEmail && !isLocal) {
      actorName = 'website';
    }

    try {
      if (path === '/api/orders' && method === 'POST')  return await createOrder(request, env, ctx, actorName);
      if (path === '/api/orders' && method === 'GET')   return await listOrders(request, env, actorName);
      if (path === '/api/stats'  && method === 'GET')   return await getStats(env, actorName);
      if (path === '/api/products' && method === 'GET') return await listProducts(env, url.searchParams.get('include_hidden') === '1' && !!actorEmail);
      if (path === '/api/upload' && method === 'POST') return await uploadImage(request, env);
      if (path === '/api/products' && method === 'POST') return await createProduct(request, env, actorName);
      if (path === '/api/inventory' && method === 'GET') return await listInventory(env);
      if (path === '/api/inventory' && method === 'POST') return await createInventory(request, env, actorName);

      const om = path.match(/^\/api\/orders\/(\d+)$/);
      if (om) {
        const id = Number(om[1]);
        if (method === 'GET')    return await getOrder(id, env, actorName);
        if (method === 'PATCH')  return await updateOrder(id, request, env, actorName);
        if (method === 'DELETE') {
          const permanent = url.searchParams.get('permanent') === 'true';
          return permanent
            ? await deleteOrder(id, env, actorName)
            : await cancelOrder(id, env, actorName);
        }
      }

      const mpm = path.match(/^\/api\/orders\/(\d+)\/mark-paid$/);
      if (mpm && method === 'POST') {
        return await markOrderPaid(Number(mpm[1]), request, env, ctx);
      }

      const grm = path.match(/^\/api\/orders\/(\d+)\/generate-receipt$/);
      if (grm && method === 'POST') {
        return await generateReceiptForOrder(Number(grm[1]), request, env, ctx, actorName);
      }

      const paym = path.match(/^\/api\/orders\/(\d+)\/payable$/);
      if (paym && method === 'GET') {
        return await getOrderPayable(Number(paym[1]), request, env);
      }

      const psm = path.match(/^\/api\/orders\/(\d+)\/payment-status$/);
      if (psm && method === 'GET') {
        return await getOrderPaymentStatus(Number(psm[1]), env);
      }

      const dm = path.match(/^\/api\/orders\/(\d+)\/deduct$/);
      if (dm && method === 'POST') {
        return await deductOrderInventory(Number(dm[1]), env, actorName);
      }

      // On-demand label generation for a single order
      const glm = path.match(/^\/api\/orders\/(\d+)\/generate-labels$/);
      if (glm && method === 'POST') {
        const id = Number(glm[1]);
        return await generateLabelsForOrderById(id, env);
      }

      // Bulk backfill labels for ALL past orders
      if (path === '/api/orders/backfill-labels' && method === 'POST') {
        return await backfillAllOrderLabels(env);
      }

      const pm = path.match(/^\/api\/products\/([A-Za-z0-9_-]+)$/);
      if (pm) {
        const id = pm[1];
        if (method === 'GET')    return await getProduct(id, env);
        if (method === 'PATCH')  return await updateProduct(id, request, env, actorName);
        if (method === 'DELETE') return await deleteProduct(id, env, actorName);
      }

      if (path === '/api/gallery' && method === 'GET') return await listGallery(env);
      if (path === '/api/gallery/all' && method === 'GET') return await listGalleryAdmin(env);
      if (path === '/api/gallery' && method === 'POST') return await createGalleryPhoto(request, env, actorName);

      const gm = path.match(/^\/api\/gallery\/([A-Za-z0-9_-]+)$/);
      if (gm) {
        const id = gm[1];
        if (method === 'PATCH')  return await updateGalleryPhoto(id, request, env, actorName);
        if (method === 'DELETE') return await deleteGalleryPhoto(id, env, actorName);
      }

      if (path === '/api/site' && method === 'GET') return await getSiteContent(env);
      if (path === '/api/site' && method === 'PUT') return await putSiteContent(request, env, actorName);
      if (path === '/api/testimonials' && method === 'GET') return await listTestimonials(env);
      if (path === '/api/testimonials' && method === 'POST') return await createTestimonial(request, env, actorName);

      const tm = path.match(/^\/api\/testimonials\/([A-Za-z0-9_-]+)$/);
      if (tm) {
        const id = tm[1];
        if (method === 'PATCH')  return await updateTestimonial(id, request, env, actorName);
        if (method === 'DELETE') return await deleteTestimonial(id, env, actorName);
      }

      const im = path.match(/^\/api\/inventory\/([A-Za-z0-9_-]+)$/);
      if (im) {
        const id = im[1];
        if (method === 'GET')    return await getInventoryItem(id, env);
        if (method === 'PATCH')  return await updateInventoryItem(id, request, env, actorName);
        if (method === 'DELETE') return await deleteInventoryItem(id, env, actorName);
      }

      const lm = path.match(/^\/api\/labels\/([A-Za-z0-9_-]+)$/);
      if (lm) {
        const id = lm[1];
        if (method === 'GET')    return await getLabelTemplate(id, env);
        if (method === 'PATCH')  return await updateLabelTemplate(id, request, env, actorName);
        if (method === 'DELETE') return await deleteLabelTemplate(id, env, actorName);
      }

      const cm = path.match(/^\/api\/customers\/([A-Za-z0-9_-]+)$/);
      if (cm) {
        const id = cm[1];
        if (method === 'GET')    return await getCustomer(id, env);
        if (method === 'PATCH')  return await updateCustomer(id, request, env, actorName);
        if (method === 'DELETE') return await deleteCustomer(id, env, actorName);
      }

      if (path === '/api/customers' && method === 'GET') return await listCustomers(env);
      if (path === '/api/customers' && method === 'POST') return await createCustomer(request, env, actorName);
      if (path === '/api/payments' && method === 'GET') return await listPayments(env);
      if (path === '/api/payments' && method === 'POST') return await createPayment(request, env, actorName);

      if (path === '/api/quotes' && method === 'POST') return await createQuote(request, env, ctx);
      if (path === '/api/quotes' && method === 'GET')  return await listQuotes(env);
      if (path === '/api/quotes/upload-image' && method === 'POST') return await uploadQuoteImage(request, env);

      const qm = path.match(/^\/api\/quotes\/(\d+)$/);
      if (qm) {
        const id = Number(qm[1]);
        if (method === 'GET')   return await getQuote(id, env);
        if (method === 'PATCH') return await updateQuote(id, request, env, ctx, actorName);
      }

      const qcm = path.match(/^\/api\/quotes\/(\d+)\/convert$/);
      if (qcm && method === 'POST') return await convertQuote(Number(qcm[1]), request, env, ctx, actorName);

      if (path === '/api/receipts' && method === 'GET') return await listReceipts(request, env);
      const rm = path.match(/^\/api\/receipts\/([^/]+)$/);
      if (rm && method === 'GET') return await getReceipt(rm[1], env);
      const rhm = path.match(/^\/api\/receipts\/([^/]+)\/html$/);
      if (rhm && method === 'GET') return await getReceiptHtml(rhm[1], env, url);
      const rsm = path.match(/^\/api\/receipts\/([^/]+)\/resend$/);
      if (rsm && method === 'POST') return await resendReceipt(rsm[1], request, env, ctx, actorName);

      if (path === '/api/labels' && method === 'GET') return await listLabelTemplates(env);
      if (path === '/api/labels' && method === 'POST') return await createLabelTemplate(request, env, actorName);
      if (path === '/api/profile' && method === 'GET') return await getProfile(env);
      if (path === '/api/profile' && method === 'PUT') return await updateProfile(request, env, actorName);
      if (path === '/api/seed/reset' && method === 'POST') return await resetSeed(env, actorName);

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error', detail: String(err) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Delete expired awaiting_payment orders older than 24 hours + their events
    await env.DB.prepare(
      "DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE status = 'awaiting_payment' AND created_at < datetime('now', '-24 hours'))"
    ).run();
    await env.DB.prepare(
      "DELETE FROM orders WHERE status = 'awaiting_payment' AND created_at < datetime('now', '-24 hours')"
    ).run();
  },
};

/**
 * Extract the authenticated user email from the Cloudflare Access JWT cookie.
 * This is a fallback when cf-access-authenticated-user-email header isn't
 * injected (Access only guards /admin*, not /api/*).
 *
 * The cookie value is a JWT: header.payload.signature
 * We only decode the payload — the signature is not verified here because
 * the cookie is HttpOnly/Secure and only Cloudflare can issue it.
 */
function emailFromAccessCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/\bCF_Authorization=([^;]+)/);
  if (!match) return null;
  const payload = match[1].split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.email || null;
  } catch {
    return null;
  }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}



async function createOrder(request, env, ctx, actor) {
  const body = await request.json();
  for (const f of ['customer_name', 'pickup_date', 'items_json', 'payment_method']) {
    if (!body[f]) return json({ error: `Missing field: ${f}` }, 400);
  }
  if (!ALLOWED_PAYMENT.includes(body.payment_method)) {
    return json({ error: `Invalid payment_method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
  }
  if (body.payment_status && !ALLOWED_PAYSTAT.includes(body.payment_status)) {
    return json({ error: `Invalid payment_status. Must be one of: ${ALLOWED_PAYSTAT.join(', ')}` }, 400);
  }
  if (body.status && !ALLOWED_STATUS.includes(body.status)) {
    return json({ error: `Invalid status. Must be one of: ${ALLOWED_STATUS.join(', ')}` }, 400);
  }
  if (body.source && !ALLOWED_SOURCE.includes(body.source)) {
    return json({ error: `Invalid source. Must be one of: ${ALLOWED_SOURCE.join(', ')}` }, 400);
  }

  const items = typeof body.items_json === 'string' ? body.items_json : JSON.stringify(body.items_json);
  const customerId = getBodyField(body, 'customer_id') || null;

  const result = await env.DB.prepare(`
    INSERT INTO orders
      (customer_name, customer_id, phone, email, pickup_date, pickup_time,
       items_json, total_cents, payment_method, payment_status, status, notes, created_by, source, language, food_coloring)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.customer_name.trim(),
    customerId,
    body.phone || null,
    body.email?.trim() || null,
    body.pickup_date,
    body.pickup_time || null,
    items,
    Number(body.total_cents) || 0,
    body.payment_method,
    body.payment_status || 'unpaid',
    body.status || 'pending',
    body.notes || null,
    actor,
    body.source || 'in-person',
    body.language || 'es',
    body.food_coloring?.trim() || null,
  ).run();

  const id = result.meta.last_row_id;
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:created')
  `).bind(id, actor).run();

  // Only fire notifications and labels for real orders (not awaiting_payment)
  if (body.status !== 'awaiting_payment') {
    ctx.waitUntil(notifyOrderCreated(env, body, id, actor));
    ctx.waitUntil(generateLabelsForOrder(env, id, body));
  }

  return json({ ok: true, id }, 201);
}



async function notifyOrderCreated(env, body, id, actor) {
  const customer = body.customer_name.trim();
  const total = body.total_cents ? '$' + (body.total_cents / 100).toFixed(2) : '—';
  const items = typeof body.items_json === 'string' ? body.items_json : JSON.stringify(body.items_json);
  let itemsStr = '';
  try { itemsStr = JSON.parse(items).map(i => `${i.qty}× ${i.name}`).join(', '); } catch { itemsStr = items; }
  const date = body.pickup_date || '—';
  const time = body.pickup_time || '—';
  const paymentLabel = body.payment_method.charAt(0).toUpperCase() + body.payment_method.slice(1);
  const msg = [
    `🆕 Order #${id}`,
    `👤 ${customer}`,
    `📦 ${itemsStr}`,
    `💰 ${total}`,
    `📅 ${date} ${time}`,
    `💳 ${paymentLabel}`,
    `🆔 #${id}`,
  ].join('\n');

  // Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }

  // Email
  if (env.EMAIL_RECIPIENT && env.RESEND_API_KEY) {
    notifyEmail(env, msg, id, { customer, itemsStr, total, date, time, paymentLabel, actor });
  }
}

async function notifyTelegram(env, msg) {
  try {
    const chatIds = String(env.TELEGRAM_CHAT_ID).split(',').map(id => id.trim()).filter(Boolean);
    await Promise.all(chatIds.map(chat_id => 
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id,
          text: msg,
          parse_mode: 'Markdown',
        }),
      })
    ));
  } catch (e) { console.error('Telegram notify failed:', e); }
}

async function notifyEmail(env, msg, id, info = {}) {
  try {
    const emails = String(env.EMAIL_RECIPIENT).split(',').map(e => e.trim()).filter(Boolean);
    const html = `<div style="font-family: sans-serif; max-width: 480px; padding: 16px;">
  <h2 style="color: #333;">🆕 Order #${id}</h2>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 6px 0; color: #555; width: 100px;"><strong>Customer</strong></td><td style="padding: 6px 0;">${info.customer || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Items</strong></td><td style="padding: 6px 0;">${info.itemsStr || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Total</strong></td><td style="padding: 6px 0;">${info.total || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Pickup</strong></td><td style="padding: 6px 0;">${info.date || ''} ${info.time || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Payment</strong></td><td style="padding: 6px 0;">${info.paymentLabel || ''}</td></tr>
  </table>
  <p style="color: #999; font-size: 12px; margin-top: 16px;">Order #${id} · Muy Rico Bakery</p>
</div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "orders@muy-rico.com",
        to: emails,
        subject: `🆕 Order #${id} — New Muy Rico Order`,
        text: msg,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Resend email failed:", res.status, err);
    }
  } catch (e) { console.error('Email notify failed:', e); }
}

async function listOrders(request, env, actor) {
  const sp = new URL(request.url).searchParams;
  const status  = sp.get('status');
  const payment = sp.get('payment');
  const paystat = sp.get('payment_status');
  const from    = sp.get('from');
  const to      = sp.get('to');
  const search  = sp.get('search');
  const limit   = Math.min(Number(sp.get('limit')) || 200, 500);

  const where = [];
  const binds = [];
  if (status)  { where.push('status = ?');         binds.push(status); }
  if (payment) { where.push('payment_method = ?'); binds.push(payment); }
  if (paystat) { where.push('payment_status = ?'); binds.push(paystat); }
  if (from)    { where.push('pickup_date >= ?');   binds.push(from); }
  if (to)      { where.push('pickup_date <= ?');   binds.push(to); }
  if (search)  { where.push('(customer_name LIKE ? OR notes LIKE ?)'); binds.push(`%${search}%`, `%${search}%`); }

  // Default: hide awaiting_payment orders unless explicitly requested
  if (!status) {
    where.push('status != ?');
    binds.push('awaiting_payment');
  }

  const sql = `
    SELECT * FROM orders
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY pickup_date ASC, pickup_time ASC, created_at DESC
    LIMIT ?
  `;
  binds.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ orders: results }, 200);
}

async function getOrder(id, env, actor) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);
  const { results: events } = await env.DB.prepare(
    'SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC'
  ).bind(id).all();
  return json({ order, events }, 200);
}

async function updateOrder(id, request, env, actor) {
  const body = await request.json();
  const allowed = ['status', 'payment_status', 'notes', 'pickup_date', 'pickup_time', 'payment_method', 'payment_sub_method', 'food_coloring'];
  const sets = [], binds = [];
  for (const f of allowed) {
    if (body[f] === undefined) continue;
    if (f === 'payment_method' && !ALLOWED_PAYMENT.includes(body[f])) return json({ error: 'Invalid payment_method' }, 400);
    if (f === 'payment_status' && !ALLOWED_PAYSTAT.includes(body[f])) return json({ error: 'Invalid payment_status' }, 400);
    if (f === 'status' && !ALLOWED_STATUS.includes(body[f])) return json({ error: 'Invalid status' }, 400);
    sets.push(`${f} = ?`); binds.push(body[f]);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);

  binds.push(id);
  const r = await env.DB.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);

  // When marking unpaid, deactivate all payments so they don't inflate totals
  if (body.payment_status === 'unpaid') {
    await env.DB.prepare(`UPDATE payments SET active = 0 WHERE order_id = ? AND active = 1`).bind(id).run();
  }

  // Keep the latest recorded payment in sync when the method is corrected
  if (body.payment_method !== undefined) {
    const latest = await env.DB.prepare(
      `SELECT id FROM payments WHERE order_id = ? AND active = 1 ORDER BY created_at DESC, id DESC LIMIT 1`
    ).bind(id).first();
    if (latest) {
      await env.DB.prepare(
        `UPDATE payments SET method = ?, method_details = COALESCE(?, method_details) WHERE id = ?`
      ).bind(body.payment_method, body.payment_sub_method ?? null, latest.id).run();
    }
  }

  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:updated')
  `).bind(id, actor).run();

  return json({ ok: true }, 200);
}

async function deductOrderInventory(orderId, env, actor) {
  try {
    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (!order) return json({ error: 'Order not found' }, 404);
    if (order.inventory_deducted) return json({ ok: true, already_deducted: true });

    const items = safeJsonParse(order.items_json, []);
    const { results: prods } = await env.DB.prepare('SELECT id, recipe, flavor_deduction_map FROM products').all();
    const prodMap = Object.fromEntries(prods.map(p => [p.id, p]));

    const { results: invRows } = await env.DB.prepare('SELECT id, quantity FROM inventory WHERE active = 1').all();
    const invMap = Object.fromEntries(invRows.map(i => [i.id, { ...i }]));

    for (const item of items) {
      const prod = prodMap[item.productId];
      if (!prod) continue;
      const recipe = safeJsonParse(prod.recipe, []);
      const deductionMap = prod.flavor_deduction_map ? safeJsonParse(prod.flavor_deduction_map, null) : null;
      const flavorNote = item.flavorNote || '';

      let deductIds = new Set();
      if (deductionMap && flavorNote) {
        for (const [groupName, options] of Object.entries(deductionMap)) {
          for (const [optionName, invIds] of Object.entries(options)) {
            if (flavorNote.includes(optionName)) {
              invIds.forEach(id => deductIds.add(id));
            }
          }
        }
      }

      for (const rec of recipe) {
        if (deductIds.size > 0 && !deductIds.has(rec.inventoryItemId)) continue;
        const inv = invMap[rec.inventoryItemId];
        if (!inv) continue;
        const used = rec.qtyPerUnit * item.qty;
        const newQty = Math.max(0, +(inv.quantity - used).toFixed(2));
        await env.DB.prepare('UPDATE inventory SET quantity = ? WHERE id = ?')
          .bind(newQty, rec.inventoryItemId).run();
        inv.quantity = newQty;
      }
    }

    await env.DB.prepare('UPDATE orders SET inventory_deducted = 1 WHERE id = ?')
      .bind(orderId).run();

    await env.DB.prepare(
      `INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:inventory-deducted')`
    ).bind(orderId, actor || 'system').run();

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function markOrderPaid(id, request, env, ctx) {
  // Authenticate via shared secret (no Cloudflare Access on this public route)
  const provided = request.headers.get('X-Webhook-Secret') || '';
  if (!env.PAYMENT_WEBHOOK_SECRET || provided !== env.PAYMENT_WEBHOOK_SECRET) {
    return json({ error: 'Forbidden — invalid webhook secret' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const method = body.method;
  if (!method || !ALLOWED_PAYMENT.includes(method)) {
    return json({ error: `Invalid or missing method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
  }
  const subMethod = body.sub_method || null;

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);

  // Idempotent: already paid → no-op (still log the event below).
  // If a replay with a different method arrives, we reject it to avoid silently overwriting.
  const alreadyPaid = order.payment_status === 'paid';

  if (!alreadyPaid) {
    await env.DB.prepare(`
      UPDATE orders SET payment_status = 'paid', payment_method = ?, payment_sub_method = ? WHERE id = ?
    `).bind(method, subMethod, id).run();
  }

  // Audit trail (additive — always record the webhook fired)
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:paid')
  `).bind(id, 'system').run();

  // Mirror the dashboard's recordPayment: insert a payments row so the Payments page shows it.
  // Guard against double-counting on replay: only insert when not already paid.
  // NOTE: orders table has NO order_number column, so we bind null for it.
  if (!alreadyPaid) {
    const payId = `pay_${id}_${Date.now().toString(36)}`;
    const customerName = order.customer_name || '';
    const amount = (Number(order.total_cents) || 0) / 100;
    await env.DB.prepare(`
      INSERT INTO payments (id, order_id, customer_name, amount, method, method_details, date, created_at, active)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
    `).bind(payId, id, customerName, amount, method, subMethod).run();

    // Transition from awaiting_payment to pending on first payment
    const wasAwaiting = order.status === 'awaiting_payment';
    if (wasAwaiting) {
      await env.DB.prepare(`UPDATE orders SET status = 'pending' WHERE id = ?`).bind(id).run();
      await env.DB.prepare(`
        INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:status_changed')
      `).bind(id, 'system').run();
    }

    // Re-read order with email + language for notifications
    const updatedOrder = await env.DB.prepare(
      'SELECT id, customer_name, email, language, items_json, total_cents, pickup_date, pickup_time, payment_method, payment_sub_method, payment_status, status, created_at FROM orders WHERE id = ?'
    ).bind(id).first();

    // Fire owner notification + customer confirmation email in background
    if (ctx) {
      ctx.waitUntil(notifyOrderPaid(env, updatedOrder, id, method));
      ctx.waitUntil((async () => {
        const result = await sendCustomerConfirmation(env, updatedOrder);
        await logReceipt(env, updatedOrder, result, id);
      })());
      // Labels were deferred for awaiting_payment orders — generate them now
      if (wasAwaiting) {
        ctx.waitUntil(generateLabelsForOrder(env, id, order));
      }
    }
  }

  if (alreadyPaid) return json({ ok: true, skipped: 'already-paid' }, 200);
  return json({ ok: true }, 200);
}

async function getOrderPayable(id, request, env) {
  const provided = request.headers.get('X-Webhook-Secret') || '';
  if (!env.PAYMENT_WEBHOOK_SECRET || provided !== env.PAYMENT_WEBHOOK_SECRET) {
    return json({ error: 'Forbidden' }, 401);
  }
  const order = await env.DB.prepare(
    'SELECT id, total_cents, status, payment_status, email, customer_name FROM orders WHERE id = ?'
  ).bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);
  return json(order, 200);
}

async function getOrderPaymentStatus(id, env) {
  const order = await env.DB.prepare(
    'SELECT payment_status, status FROM orders WHERE id = ?'
  ).bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);
  return json({ payment_status: order.payment_status, status: order.status }, 200);
}

async function notifyOrderPaid(env, order, id, method) {
  const customer = order.customer_name.trim();
  const total = order.total_cents ? '$' + (order.total_cents / 100).toFixed(2) : '—';
  let itemsStr = '';
  try { itemsStr = JSON.parse(order.items_json).map(i => `${i.qty}× ${i.name}`).join(', '); } catch { itemsStr = order.items_json; }
  const date = order.pickup_date || '—';
  const time = order.pickup_time || '—';
  const paymentLabel = method.charAt(0).toUpperCase() + method.slice(1);
  const msg = [
    `✅ Order #${id} — PAID`,
    `👤 ${customer}`,
    `📦 ${itemsStr}`,
    `💰 ${total}`,
    `📅 ${date} ${time}`,
    `💳 ${paymentLabel}`,
    `🆔 #${id}`,
    `📧 ${order.email || '—'}`,
  ].join('\n');

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }
  if (env.EMAIL_RECIPIENT && env.RESEND_API_KEY) {
    notifyEmail(env, msg, id, { customer, itemsStr, total, date, time, paymentLabel, actor: 'system' });
  }
}

function buildMethodLabel(order, isEn) {
  const method = order.payment_method;
  let label;
  if (method === 'stripe') label = isEn ? 'Card' : 'Tarjeta';
  else if (method === 'paypal') label = 'PayPal';
  else if (method === 'cashapp') label = 'Cash App';
  else if (method === 'venmo') label = 'Venmo';
  else if (method === 'applepay') label = 'Apple Pay';
  else if (method === 'cash') label = isEn ? 'Cash' : 'Efectivo';
  else label = method || '—';
  // Append sub-method details for Stripe/PayPal
  const sub = order.payment_sub_method;
  if (sub) {
    try {
      const parsed = JSON.parse(sub);
      if (parsed.type === 'card' && parsed.brand) {
        const brand = parsed.brand.charAt(0).toUpperCase() + parsed.brand.slice(1).toLowerCase();
        const funding = parsed.funding ? ' ' + parsed.funding.charAt(0).toUpperCase() + parsed.funding.slice(1).toLowerCase() : '';
        const last4 = parsed.last4 ? ' (…' + parsed.last4 + ')' : '';
        label = `${brand}${funding}${last4}`;
      } else if (parsed.type === 'paypal_wallet') {
        label = 'PayPal Wallet';
      }
    } catch { /* keep base label */ }
  }
  return label;
}

function formatStatusLabel(status, isEn) {
  const map = isEn ? {
    'pending': 'Pending',
    'in-progress': 'In Progress',
    'ready': 'Ready',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
    'awaiting_payment': 'Awaiting Payment',
  } : {
    'pending': 'Pendiente',
    'in-progress': 'En Progreso',
    'ready': 'Listo',
    'completed': 'Completado',
    'cancelled': 'Cancelado',
    'awaiting_payment': 'Esperando Pago',
  };
  return map[status] || status;
}

function buildReceiptHtml(order, isEn) {
  const customer = order.customer_name.trim();
  const total = order.total_cents ? '$' + (order.total_cents / 100).toFixed(2) : '$0.00';
  const orderDate = (order.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const methodLabel = buildMethodLabel(order, isEn);
  const statusLabel = order.status ? formatStatusLabel(order.status, isEn) : '—';

  // Itemized receipt rows: name, qty × unit, line total (right-aligned like a paper receipt)
  let itemRows = '';
  try {
    const items = JSON.parse(order.items_json);
    itemRows = items.map(i => {
      const line = (i.qty * i.price).toFixed(2);
      return `<tr>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #4a423d; font-size: 14px;">${i.name}</td>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #8a8078; font-size: 13px; text-align: center; white-space: nowrap;">${i.qty} × $${Number(i.price).toFixed(2)}</td>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #4a423d; font-size: 14px; text-align: right; font-weight: 600;">$${line}</td>
      </tr>`;
    }).join('');
  } catch {
    itemRows = `<tr><td style="padding: 10px 0; color: #4a423d; font-size: 14px;">${order.items_json}</td><td></td><td></td></tr>`;
  }

  const L = isEn ? {
    receipt: 'RECEIPT',
    thanks: 'Thank you for your order!',
    paidNote: 'Your payment was received and your order is being prepared.',
    date: 'Date',
    payment: 'Payment',
    statusLabel: 'Status',
    pickup: 'Pickup',
    item: 'Item',
    qty: 'Qty',
    amount: 'Amount',
    total: 'TOTAL PAID',
    contact: 'Questions about your order? Reply to this email or call/text us at (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  } : {
    receipt: 'RECIBO',
    thanks: '¡Gracias por tu pedido!',
    paidNote: 'Tu pago fue recibido y tu pedido se está preparando.',
    date: 'Fecha',
    payment: 'Pago',
    statusLabel: 'Estado',
    pickup: 'Recogida',
    item: 'Producto',
    qty: 'Cant.',
    amount: 'Importe',
    total: 'TOTAL PAGADO',
    contact: '¿Preguntas sobre tu pedido? Responde a este correo o llámanos al (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  };

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #faf7f2; padding: 24px 12px; color: #333;">
<div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.07);">

  <div style="background: #1e4636; padding: 28px 32px 24px; text-align: center;">
    <img src="https://muy-rico.com/muy_rico_logo_email.png" alt="Muy Rico Bakery" width="180" style="width: 180px; max-width: 60%; height: auto; display: block; margin: 0 auto 10px;" />
    <div style="color: #d4edda; font-size: 12px; letter-spacing: 3px; font-weight: 600;">${L.receipt}</div>
  </div>

  <div style="padding: 28px 32px 8px;">
    <h2 style="margin: 0 0 6px; color: #2d7a46; font-size: 20px;">${L.thanks}</h2>
    <p style="margin: 0 0 20px; color: #6b615a; font-size: 14px; line-height: 1.5;">${customer} — ${L.paidNote}</p>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.date}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${orderDate}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.payment}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${methodLabel}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.statusLabel}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${statusLabel}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.pickup}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${order.pickup_date || '—'}${order.pickup_time ? ' ' + order.pickup_time : ''}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">Order</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0; font-weight: 600;">#${order.id}</td>
      </tr>
    </table>

    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="text-align: left; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.item}</th>
          <th style="text-align: center; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.qty}</th>
          <th style="text-align: right; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.amount}</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding: 14px 0 4px; color: #1e4636; font-size: 15px; font-weight: 700;">${L.total}</td>
          <td style="padding: 14px 0 4px; color: #1e4636; font-size: 18px; font-weight: 700; text-align: right;">${total}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div style="padding: 20px 32px 28px;">
    <p style="color: #8a8078; font-size: 13px; line-height: 1.6; margin: 0 0 6px;">${L.contact}</p>
    <p style="color: #b8ada2; font-size: 12px; margin: 14px 0 0; text-align: center;">${L.footer}</p>
  </div>

</div>
</div>`;
}

async function sendCustomerConfirmation(env, order) {
  const email = order.email;
  if (!email || !env.RESEND_API_KEY) {
    console.warn('sendCustomerConfirmation: missing email or RESEND_API_KEY for order', order.id);
    return { ok: false };
  }

  const isEn = order.language === 'en';
  const html = buildReceiptHtml(order, isEn);

  const customer = order.customer_name.trim();
  const total = order.total_cents ? '$' + (order.total_cents / 100).toFixed(2) : '$0.00';
  const orderDate = (order.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const methodLabel = buildMethodLabel(order, isEn);
  const statusLabel = order.status ? formatStatusLabel(order.status, isEn) : '—';

  const L = isEn ? {
    subject: `Receipt — Muy Rico Order #${order.id}`,
    receipt: 'RECEIPT',
    thanks: 'Thank you for your order!',
    paidNote: 'Your payment was received and your order is being prepared.',
    date: 'Date',
    payment: 'Payment',
    statusLabel: 'Status',
    pickup: 'Pickup',
    total: 'TOTAL PAID',
    contact: 'Questions about your order? Reply to this email or call/text us at (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  } : {
    subject: `Recibo — Pedido Muy Rico #${order.id}`,
    receipt: 'RECIBO',
    thanks: '¡Gracias por tu pedido!',
    paidNote: 'Tu pago fue recibido y tu pedido se está preparando.',
    date: 'Fecha',
    payment: 'Pago',
    statusLabel: 'Estado',
    pickup: 'Recogida',
    total: 'TOTAL PAGADO',
    contact: '¿Preguntas sobre tu pedido? Responde a este correo o llámanos al (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  };

  // Plain-text fallback (improves spam score + accessibility)
  let textItems = '';
  try {
    const items = JSON.parse(order.items_json);
    textItems = items.map(i => `${i.qty} x ${i.name} — $${(i.qty * i.price).toFixed(2)}`).join('\n');
  } catch { textItems = order.items_json; }
  const text = [
    `Muy Rico Bakery — ${L.receipt}`,
    ``,
    `${L.thanks}`,
    `${customer} — ${L.paidNote}`,
    ``,
    `${L.date}: ${orderDate}`,
    `${L.payment}: ${methodLabel}`,
    `${L.statusLabel}: ${statusLabel}`,
    `${L.pickup}: ${order.pickup_date || '—'}${order.pickup_time ? ' ' + order.pickup_time : ''}`,
    `Order: #${order.id}`,
    ``,
    textItems,
    ``,
    `${L.total}: ${total}`,
    ``,
    L.contact,
    L.footer,
  ].join('\n');

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "orders@muy-rico.com",
        to: [email],
        subject: L.subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Resend customer email failed:", res.status, err);
      return { ok: false };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.id || null };
  } catch (e) {
    console.error('Customer email notify failed:', e);
    return { ok: false };
  }

  return { ok: false };
}

async function logReceiptWithId(env, order, emailResult, orderId, receiptId) {
  let status;
  if (emailResult && emailResult.ok) status = 'sent';
  else if (emailResult && emailResult.skipped) status = 'printed';
  else status = 'failed';
  const messageId = (emailResult && emailResult.messageId) || null;
  try {
    await env.DB.prepare(`
      INSERT INTO receipts (id, order_id, order_number, customer_name, email, items_json, total_cents, payment_method, payment_sub_method, order_status, status, message_id, sent_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      receiptId,
      orderId,
      `MR-${orderId}`,
      order.customer_name || '',
      order.email || null,
      order.items_json || '[]',
      Number(order.total_cents) || 0,
      order.payment_method || 'unknown',
      order.payment_sub_method || null,
      order.status || 'pending',
      status,
      messageId,
    ).run();
    const eventLabel = status === 'sent' ? 'receipt:sent' : status === 'printed' ? 'receipt:printed' : 'receipt:failed';
    await env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)
    `).bind(orderId, 'system', eventLabel).run();
  } catch (e) {
    console.error('logReceipt failed:', e);
  }
}

async function logReceipt(env, order, emailResult, orderId) {
  const receiptId = `rcpt_${orderId}_${Date.now().toString(36)}`;
  await logReceiptWithId(env, order, emailResult, orderId, receiptId);
}

async function listReceipts(request, env) {
  const sp = new URL(request.url).searchParams;
  const orderId = sp.get('order_id');
  const email = sp.get('email');
  const search = sp.get('search');
  const limit = Math.min(Number(sp.get('limit')) || 200, 500);
  const where = [];
  const binds = [];
  if (orderId) { where.push('order_id = ?'); binds.push(Number(orderId)); }
  if (email) { where.push('email LIKE ?'); binds.push(`%${email}%`); }
  if (search) { where.push('(customer_name LIKE ? OR order_number LIKE ?)'); binds.push(`%${search}%`, `%${search}%`); }
  const sql = `
    SELECT * FROM receipts
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  binds.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ receipts: results.map(snakeToCamelObject) }, 200);
}

async function getReceipt(id, env) {
  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  if (!receipt) return json({ error: 'Not found' }, 404);
  return json({ receipt: snakeToCamelObject(receipt) }, 200);
}

async function getReceiptHtml(id, env, url) {
  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  if (!receipt) return json({ error: 'Not found' }, 404);
  // Fetch the full order for pickup_date, pickup_time, language, created_at
  let order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(receipt.order_id).first();
  let isEn = true;
  if (order) {
    isEn = order.language === 'en';
  } else {
    // Order deleted — fall back to receipt snapshot (no pickup date/time)
    order = {
      id: receipt.order_id,
      customer_name: receipt.customer_name || '',
      email: receipt.email || null,
      items_json: receipt.items_json || '[]',
      total_cents: receipt.total_cents || 0,
      payment_method: receipt.payment_method || 'unknown',
      payment_sub_method: receipt.payment_sub_method || null,
      status: receipt.order_status || 'pending',
      pickup_date: null,
      pickup_time: null,
      created_at: receipt.created_at,
    };
  }
  // ?lang= query param overrides order language
  const langParam = url?.searchParams?.get('lang');
  if (langParam === 'en') isEn = true;
  else if (langParam === 'es') isEn = false;

  const html = buildReceiptHtml(order, isEn);
  const togglePath = url?.pathname || `/api/receipts/${id}/html`;
  const autoPrint = !url?.searchParams?.has('lang');

  const toggleBar = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #faf7f2; padding: 8px 12px; text-align: center; border-bottom: 1px solid #e3dcd2;">
  <span style="color: #8a8078; font-size: 12px; margin-right: 8px;">Language / Idioma:</span>
  <a href="${togglePath}?lang=en" style="display: inline-block; padding: 4px 12px; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 4px; ${isEn ? 'background:#1e4636;color:#fff;' : 'background:#e3dcd2;color:#4a423d;'} margin: 0 2px;">EN</a>
  <a href="${togglePath}?lang=es" style="display: inline-block; padding: 4px 12px; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 4px; ${!isEn ? 'background:#1e4636;color:#fff;' : 'background:#e3dcd2;color:#4a423d;'} margin: 0 2px;">ES</a>
</div>`;

  const printable = toggleBar + html + (autoPrint ? '\n<script>window.print();</script>' : '');
  return new Response(printable, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS },
  });
}

async function resendReceipt(id, request, env, ctx, actor) {
  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  if (!receipt) return json({ error: 'Not found' }, 404);
  // Fetch the current order to send a fresh receipt
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(receipt.order_id).first();
  if (!order) return json({ error: 'Order not found' }, 404);
  const result = await sendCustomerConfirmation(env, order);
  await logReceipt(env, order, result, receipt.order_id);
  return json({ ok: true, status: result.ok ? 'sent' : 'failed', messageId: result.messageId || null }, 200);
}

async function generateReceiptForOrder(id, request, env, ctx, actor) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Order not found' }, 404);

  let emailResult;
  if (order.email && env.RESEND_API_KEY) {
    emailResult = await sendCustomerConfirmation(env, order);
  } else {
    emailResult = { ok: false, messageId: null, skipped: true };
  }

  const receiptId = `rcpt_${id}_${Date.now().toString(36)}`;
  await logReceiptWithId(env, order, emailResult, id, receiptId);

  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'receipt:generated')
  `).bind(id, actor || 'system').run();

  return json({
    ok: true,
    receiptId,
    status: emailResult.ok ? 'sent' : emailResult.skipped ? 'printed' : 'failed',
    messageId: emailResult.messageId || null,
  }, 200);
}

async function cancelOrder(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:cancelled')
  `).bind(id, actor).run();
  return json({ ok: true }, 200);
}

async function deleteOrder(id, env, actor) {
  // Hard-delete: remove order events first (foreign key), then the order row itself.
  await env.DB.prepare(`DELETE FROM order_events WHERE order_id = ?`).bind(id).run();
  const r = await env.DB.prepare(`DELETE FROM orders WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function getStats(env, actor) {
  const { results } = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('pending','in-progress','ready') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'pending'     THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'ready'       THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN status IN ('completed','done') THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'cancelled'   THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN payment_status = 'unpaid' AND status NOT IN ('cancelled') THEN 1 ELSE 0 END) AS unpaid,
      SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS paid
    FROM orders WHERE status != 'awaiting_payment'
  `).all();
  const stats = results[0] || {};
  // Count pending cake quotes
  const { results: quoteRows } = await env.DB.prepare(`
    SELECT COUNT(*) AS cnt FROM cake_quotes WHERE status = 'new'
  `).all();
  stats.pending_quotes = (quoteRows && quoteRows[0] && quoteRows[0].cnt) || 0;
  return json(stats, 200);
}

// ─── Products ────────────────────────────────────────────────────────────────

function parseFlavors(v) {
  if (v == null || v === '') return '[]';
  if (Array.isArray(v)) return JSON.stringify(v);
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return JSON.stringify(parsed);
  } catch {}
  return JSON.stringify(String(v).split(',').map((s) => s.trim()).filter(Boolean));
}

function safeJsonParse(v, fallback) {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v; // already parsed (array/object)
  try {
    const parsed = JSON.parse(v);
    return parsed;
  } catch {
    return fallback;
  }
}

function migrateFlavorGroups(v) {
  if (!Array.isArray(v)) return [];
  if (!v.length) return [];
  if (typeof v[0] === 'string') {
    return [{ name: 'Flavor', options: [...v] }];
  }
  return v;
}

const ALLOWED_IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
const MAX_IMG_BYTES = 5 * 1024 * 1024;

async function uploadImage(request, env) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return json({ error: 'No file provided' }, 400);
    }
    if (!ALLOWED_IMG.includes(file.type)) {
      return json({ error: 'Only JPG, PNG, or WEBP images allowed' }, 400);
    }
    if (file.size > MAX_IMG_BYTES) {
      return json({ error: 'Image must be 5MB or smaller' }, 400);
    }
    const ext = (file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const key = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await env.IMAGES_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    const url = `https://pub-${env.R2_PUBLIC_ID || '71c703c51efd43de8dde4439bd02a8af'}.r2.dev/${key}`;


    return json({ url }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

function parseRecipe(v) {
  if (v == null || v === '') return '[]';
  if (Array.isArray(v)) return JSON.stringify(v);
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return JSON.stringify(parsed);
    return '[]';
  } catch {
    return '[]';
  }
}

async function listProducts(env, includeHidden) {
  const where = includeHidden
    ? 'WHERE active = 1'
    : 'WHERE active = 1 AND show_online = 1';
  const cols = includeHidden
    ? '*'
    : 'id, name, name_es, description, description_es, category, price, sku, emoji, image_url, active, show_online, ingredients, allergens, flavors, pack_sizes, recipe, display_order, auto_generate_label, featured, flavor_deduction_map';
  const { results } = await env.DB.prepare(`
    SELECT ${cols} FROM products
    ${where}
    ORDER BY display_order ASC, name ASC
  `).all();
  const products = (results || []).map(r => {
    const flavorGroups = migrateFlavorGroups(safeJsonParse(r.flavors, []));
    return {
      ...r,
      flavor_groups: flavorGroups,
      flavors: flavorGroups,
      pack_sizes: safeJsonParse(r.pack_sizes, []),
      recipe: safeJsonParse(r.recipe, []),
      active: Boolean(r.active),
      auto_generate_label: Boolean(r.auto_generate_label),
      featured: Boolean(r.featured),
      show_online: r.show_online === undefined ? true : Boolean(r.show_online),
      flavor_deduction_map: r.flavor_deduction_map ? safeJsonParse(r.flavor_deduction_map, null) : null,
    };
  });
  return json({ products }, 200);
}

async function getProduct(id, env) {
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  const flavorGroups = migrateFlavorGroups(safeJsonParse(row.flavors, []));
  const product = {
    ...row,
    flavor_groups: flavorGroups,
    flavors: flavorGroups,
    pack_sizes: safeJsonParse(row.pack_sizes, []),
    recipe: safeJsonParse(row.recipe, []),
    active: Boolean(row.active),
    auto_generate_label: Boolean(row.auto_generate_label),
    featured: Boolean(row.featured),
    show_online: row.show_online === undefined ? true : Boolean(row.show_online),
    flavor_deduction_map: row.flavor_deduction_map ? safeJsonParse(row.flavor_deduction_map, null) : null,
  };
  return json({ product }, 200);
}

const PRODUCT_FIELDS = [
  'name', 'name_es', 'description', 'description_es', 'category',
  'price', 'cost', 'sku', 'emoji', 'image_url',
  'active', 'ingredients', 'allergens',
  'flavors', 'pack_sizes', 'recipe', 'display_order', 'auto_generate_label',
  'featured', 'show_online', 'flavor_deduction_map',
];

async function createProduct(request, env, actor) {
  const body = await request.json();
  if (!body.id || !body.name || !body.category || !body.emoji) {
    return json({ error: 'Missing required fields: id, name, category, emoji' }, 400);
  }
  if (typeof body.id !== 'string' || body.id.length > 64) {
    return json({ error: 'id must be a short string' }, 400);
  }
  try {
    await env.DB.prepare(`
      INSERT INTO products
        (id, name, name_es, description, description_es, category, price, cost,
         sku, emoji, image_url, active, ingredients, allergens, flavors, pack_sizes, recipe, display_order, auto_generate_label, featured, show_online, flavor_deduction_map)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.id,
      body.name,
      body.name_es || null,
      body.description || null,
      body.description_es || null,
      body.category,
      Number(body.price) || 0,
      Number(body.cost) || 0,
      body.sku || null,
      body.emoji,
      body.image_url || null,
      body.active === false ? 0 : 1,
      body.ingredients || null,
      body.allergens || null,
      parseFlavors(body.flavor_groups || body.flavors || []),
      parseFlavors(body.pack_sizes || []),
      parseRecipe(body.recipe),
      Number(body.display_order) || 0,
      body.auto_generate_label === false ? 0 : 1,
      body.featured ? 1 : 0,
      body.show_online === false ? 0 : 1,
      body.flavor_deduction_map ? (typeof body.flavor_deduction_map === 'string' ? body.flavor_deduction_map : JSON.stringify(body.flavor_deduction_map)) : null,
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id: body.id }, 201);
}

async function updateProduct(id, request, env, actor) {
  let body = await request.json();
  if (body.flavor_groups !== undefined && body.flavors === undefined) {
    body = { ...body, flavors: body.flavor_groups };
  }
  const sets = [];
  const binds = [];
  for (const f of PRODUCT_FIELDS) {
    if (body[f] === undefined) continue;
    let val = body[f];
    if (f === 'active' || f === 'featured' || f === 'auto_generate_label' || f === 'show_online') val = val ? 1 : 0;
    if (f === 'flavors') val = parseFlavors(body.flavor_groups || body.flavors || []);
    if (f === 'pack_sizes') val = parseFlavors(body.pack_sizes || []);
    if (f === 'recipe')  val = parseRecipe(val);
    if (f === 'flavor_deduction_map') val = val ? (typeof val === 'string' ? val : JSON.stringify(val)) : null;
    if (f === 'price' || f === 'cost' || f === 'display_order') val = Number(val) || 0;
    sets.push(`${f} = ?`);
    binds.push(val);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteProduct(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Gallery ───────────────────────────────────────────────────────────────

const GALLERY_FIELDS = [
  'product_id', 'title', 'title_es', 'image_url', 'active', 'display_order',
];

function mapGalleryRow(r) {
  return {
    id: r.id,
    product_id: r.product_id,
    title: r.title,
    title_es: r.title_es,
    image_url: r.image_url,
    active: Boolean(r.active),
    display_order: Number(r.display_order) || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
    product_name: r.product_name || null,
    product_name_es: r.product_name_es || null,
    product_emoji: r.product_emoji || null,
    product_display_order: Number(r.product_display_order) || 0,
  };
}

async function listGallery(env) {
  const { results } = await env.DB.prepare(`
    SELECT g.*,
           p.name AS product_name,
           p.name_es AS product_name_es,
           p.emoji AS product_emoji,
           p.display_order AS product_display_order
    FROM gallery g
    LEFT JOIN products p ON p.id = g.product_id
    WHERE g.active = 1
      AND (p.show_online IS NULL OR p.show_online = 1)
    ORDER BY COALESCE(p.display_order, 9999) ASC, g.display_order ASC, g.created_at ASC
  `).all();
  return json({ photos: (results || []).map(mapGalleryRow) }, 200);
}

async function listGalleryAdmin(env) {
  const { results } = await env.DB.prepare(`
    SELECT g.*,
           p.name AS product_name,
           p.name_es AS product_name_es,
           p.emoji AS product_emoji,
           p.display_order AS product_display_order
    FROM gallery g
    LEFT JOIN products p ON p.id = g.product_id
    ORDER BY COALESCE(p.display_order, 9999) ASC, g.display_order ASC, g.created_at ASC
  `).all();
  return json({ photos: (results || []).map(mapGalleryRow) }, 200);
}

async function createGalleryPhoto(request, env, actor) {
  const body = await request.json();
  if (!body.product_id || !body.title || !body.image_url) {
    return json({ error: 'Missing required fields: product_id, title, image_url' }, 400);
  }
  const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(body.product_id).first();
  if (!product) return json({ error: 'product_id not found' }, 400);

  const id = body.id || `gal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    await env.DB.prepare(`
      INSERT INTO gallery (id, product_id, title, title_es, image_url, active, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      body.product_id,
      body.title,
      body.title_es || null,
      body.image_url,
      body.active === false ? 0 : 1,
      Number(body.display_order) || 0,
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id }, 201);
}

async function updateGalleryPhoto(id, request, env, actor) {
  const body = await request.json();
  if (body.product_id !== undefined) {
    if (!body.product_id) return json({ error: 'product_id is required' }, 400);
    const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(body.product_id).first();
    if (!product) return json({ error: 'product_id not found' }, 400);
  }
  const sets = [];
  const binds = [];
  for (const f of GALLERY_FIELDS) {
    if (body[f] === undefined) continue;
    let val = body[f];
    if (f === 'active') val = val ? 1 : 0;
    if (f === 'display_order') val = Number(val) || 0;
    sets.push(`${f} = ?`);
    binds.push(val);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE gallery SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteGalleryPhoto(id, env, actor) {
  const r = await env.DB.prepare(
    `DELETE FROM gallery WHERE id = ?`
  ).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Site content + testimonials (homepage editing) ───────────────────────

function mapSiteRow(r) {
  return { value_en: r.value_en, value_es: r.value_es, image_url: r.image_url };
}

async function getSiteContent(env) {
  const { results: rows } = await env.DB.prepare('SELECT * FROM site_content').all();
  const { results: ts } = await env.DB.prepare(`
    SELECT * FROM testimonials WHERE published = 1
    ORDER BY display_order ASC, created_at DESC LIMIT 12
  `).all();
  const content = {};
  for (const r of rows || []) content[r.key] = mapSiteRow(r);
  return json({ content, testimonials: (ts || []).map(mapTestimonialRow) }, 200);
}

async function putSiteContent(request, env, actor) {
  const body = await request.json();
  const source = body && typeof body === 'object' ? (body.content || body) : {};
  const stmts = [];
  for (const [key, val] of Object.entries(source)) {
    if (!/^[a-z0-9_]{1,64}$/.test(key)) continue;
    const v = val && typeof val === 'object' ? val : {};
    stmts.push(env.DB.prepare(`
      INSERT INTO site_content (key, value_en, value_es, image_url, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value_en = excluded.value_en,
        value_es = excluded.value_es,
        image_url = excluded.image_url,
        updated_at = datetime('now')
    `).bind(
      key,
      v.value_en != null ? String(v.value_en) : null,
      v.value_es != null ? String(v.value_es) : null,
      v.image_url != null ? String(v.image_url) : null,
    ));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, updated: stmts.length }, 200);
}

// ─── Testimonials ──────────────────────────────────────────────────────────

const TESTIMONIAL_FIELDS = ['quote_en', 'quote_es', 'author', 'occasion', 'published', 'display_order'];

function mapTestimonialRow(r) {
  return {
    id: r.id,
    quote_en: r.quote_en,
    quote_es: r.quote_es,
    author: r.author,
    occasion: r.occasion,
    published: Boolean(r.published),
    display_order: Number(r.display_order) || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function listTestimonials(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM testimonials ORDER BY display_order ASC, created_at DESC
  `).all();
  return json({ testimonials: (results || []).map(mapTestimonialRow) }, 200);
}

async function createTestimonial(request, env, actor) {
  const body = await request.json();
  if (!body.quote_en) return json({ error: 'Missing required field: quote_en' }, 400);
  const id = body.id || `tst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    await env.DB.prepare(`
      INSERT INTO testimonials (id, quote_en, quote_es, author, occasion, published, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      body.quote_en,
      body.quote_es || null,
      body.author || null,
      body.occasion || null,
      body.published ? 1 : 0,
      Number(body.display_order) || 0,
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id }, 201);
}

async function updateTestimonial(id, request, env, actor) {
  const body = await request.json();
  const sets = [];
  const binds = [];
  for (const f of TESTIMONIAL_FIELDS) {
    if (body[f] === undefined) continue;
    let val = body[f];
    if (f === 'published') val = val ? 1 : 0;
    if (f === 'display_order') val = Number(val) || 0;
    sets.push(`${f} = ?`);
    binds.push(val);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE testimonials SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteTestimonial(id, env, actor) {
  const r = await env.DB.prepare(`DELETE FROM testimonials WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Inventory ─────────────────────────────────────────────────────────────
// All endpoints are admin-only — never in the public allowlist. Inventory
// leaks cost/supplier/reorder-level data.

const INVENTORY_FIELDS = [
  'name', 'category', 'quantity', 'unit',
  'reorder_level', 'cost_per_unit', 'supplier',
  'ingredients_label', 'allergens', 'unit_weight',
  'active',
];

function parseAllergens(v) {
  if (v == null || v === '') return '[]';
  if (Array.isArray(v)) return JSON.stringify(v);
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) return JSON.stringify(parsed);
  } catch {}
  return JSON.stringify(String(v).split(',').map((s) => s.trim()).filter(Boolean));
}

async function listInventory(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM inventory
    WHERE active = 1
    ORDER BY category ASC, name ASC
  `).all();
  return json({ inventory: results }, 200);
}

async function getInventoryItem(id, env) {
  const row = await env.DB.prepare('SELECT * FROM inventory WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  return json({ item: row }, 200);
}

async function createInventory(request, env, actor) {
  const body = await request.json();
  if (!body.id || !body.name || !body.category || !body.unit) {
    return json({ error: 'Missing required fields: id, name, category, unit' }, 400);
  }
  if (typeof body.id !== 'string' || body.id.length > 64) {
    return json({ error: 'id must be a short string' }, 400);
  }
  try {
    await env.DB.prepare(`
      INSERT INTO inventory
        (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
         ingredients_label, allergens, unit_weight, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.id,
      body.name,
      body.category,
      Number(body.quantity) || 0,
      body.unit,
      Number(body.reorder_level) || 0,
      Number(body.cost_per_unit) || 0,
      body.supplier || null,
      body.ingredients_label || null,
      parseAllergens(body.allergens),
      typeof body.unit_weight === 'number' && !Number.isNaN(body.unit_weight) ? body.unit_weight : null,
      body.active === false ? 0 : 1,
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id: body.id }, 201);
}

async function updateInventoryItem(id, request, env, actor) {
  const body = await request.json();
  const sets = [];
  const binds = [];
  for (const f of INVENTORY_FIELDS) {
    if (body[f] === undefined) continue;
    let val = body[f];
    if (f === 'active') val = val ? 1 : 0;
    if (f === 'allergens') val = parseAllergens(val);
    if (f === 'quantity' || f === 'reorder_level' || f === 'cost_per_unit' || f === 'unit_weight') {
      val = val === null || val === '' ? null : Number(val);
    }
    sets.push(`${f} = ?`);
    binds.push(val);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE inventory SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteInventoryItem(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE inventory SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Customers ──────────────────────────────────────────────────────────────

const CUSTOMER_FIELDS = ['name', 'phone', 'email', 'notes'];

async function listCustomers(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM customers WHERE active = 1 ORDER BY created_at DESC
  `).all();
  return json({ customers: results.map(snakeToCamelObject) }, 200);
}

async function getCustomer(id, env) {
  const row = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  return json({ customer: snakeToCamelObject(row) }, 200);
}

async function createCustomer(request, env, actor) {
  const body = await request.json();
  if (!body.id || !body.name) return json({ error: 'Missing required fields: id, name' }, 400);
  if (typeof body.id !== 'string' || body.id.length > 64) return json({ error: 'id must be a short string' }, 400);
  try {
    await env.DB.prepare(`
      INSERT INTO customers (id, name, phone, email, notes, created_at, active)
      VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
    `).bind(
      body.id, body.name, body.phone || null, body.email || null, body.notes || null
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id: body.id }, 201);
}

async function updateCustomer(id, request, env, actor) {
  const body = await request.json();
  const sets = [], binds = [];
  for (const f of CUSTOMER_FIELDS) {
    const val = getBodyField(body, f);
    if (val === undefined) continue;
    sets.push(`${f} = ?`); binds.push(val);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteCustomer(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE customers SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Payments ───────────────────────────────────────────────────────────────

async function listPayments(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM payments WHERE active = 1 ORDER BY date DESC, created_at DESC
  `).all();
  return json({ payments: results.map(snakeToCamelObject) }, 200);
}

async function createPayment(request, env, actor) {
  const body = await request.json();
  const customerName = getBodyField(body, 'customer_name');
  if (!body.id || !customerName || !body.method) {
    return json({ error: 'Missing required fields: id, customer_name, method' }, 400);
  }
  if (!ALLOWED_PAYMENT.includes(body.method)) {
    return json({ error: `Invalid method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
  }
  const orderId = getBodyField(body, 'order_id');
  const amount = Number(body.amount) || 0;

  // Deactivate ALL existing active payments for this order before inserting.
  // This prevents double-counting when toggling paid/unpaid/paid again.
  // We use order_id alone (no amount match) because any prior active payment
  // for the same order is stale once we record a new one.
  if (orderId != null) {
    await env.DB.prepare(`
      UPDATE payments SET active = 0 WHERE order_id = ? AND active = 1
    `).bind(orderId).run();
  }

  try {
    await env.DB.prepare(`
      INSERT INTO payments (id, order_id, order_number, customer_name, amount, method, date, created_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
    `).bind(
      body.id,
      orderId,
      getBodyField(body, 'order_number') || null,
      customerName,
      amount,
      body.method,
      body.date || null,
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id: body.id }, 201);
}

async function deletePayment(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE payments SET active = 0 WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Label templates ─────────────────────────────────────────────────────────

const LABEL_FIELDS = [
  'name', 'shape', 'bg_color', 'accent_color', 'text_color', 'business_name',
  'product_name', 'details', 'ingredients', 'allergens', 'net_weight', 'price',
  'show_price', 'show_best_by', 'best_by_days', 'best_by_date', 'logo_emoji', 'logo_image', 'logo_size',
  'font', 'business_id_mode', 'address', 'phone_number', 'registration_number',
  'show_disclaimer', 'label_width', 'label_height', 'display_order',
  'elements', 'website_url', 'orientation',
  'disclaimer_variant', 'product_type', 'net_weight_us', 'net_weight_metric',
  'allergen_tags', 'no_allergens_confirmed', 'nutrient_claim', 'bg_image', 'avery_preset',
];

// FDA major allergens for auto-tagging from allergen text
const FDA_ALLERGENS = ['milk', 'eggs', 'wheat', 'soybeans', 'soy', 'peanuts', 'tree nuts', 'fish', 'shellfish', 'sesame'];

function parseAllergenTags(allergenText) {
  if (!allergenText) return [];
  const lower = allergenText.toLowerCase();
  return FDA_ALLERGENS.filter(a => lower.includes(a));
}

async function generateLabelsForOrder(env, orderId, body) {
  let items = [];
  try {
    items = typeof body.items_json === 'string' ? JSON.parse(body.items_json) : body.items_json;
  } catch(e) { return; }

  const profileRow = await env.DB.prepare("SELECT * FROM business_profile WHERE id = 'singleton'").first();
  const profile = profileRow || {};
  const foodColoring = (body.food_coloring || '').trim();
  const orderPrefix = `MR-${orderId}`;

  // Load all products once for name-based fallback matching
  const { results: allProducts } = await env.DB.prepare('SELECT * FROM products WHERE active = 1').all();

  for (const item of items) {
    // Resolve product — prefer productId, fall back to name matching
    let product = null;
    if (item.productId) {
      product = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(item.productId).first();
    }
    if (!product && item.name) {
      product = allProducts.find(p =>
        p.name.toLowerCase() === item.name.toLowerCase() ||
        item.name.toLowerCase().includes(p.name.toLowerCase())
      ) || null;
    }
    if (!product || !product.auto_generate_label) continue;

    // Label identity = the line item's own name (includes flavor/pack, e.g.
    // "Cupcakes (6) (Cupcake flavor: Chocolate)") so each flavor gets its own label.
    const itemName = (item.name || product.name).trim();

    // Skip if label already exists for this order + item
    const existing = await env.DB.prepare(
      `SELECT id FROM label_templates WHERE name = ? LIMIT 1`
    ).bind(`${orderPrefix} - ${itemName}`).first();
    if (existing) continue;

    const labelId = `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const labelName = `${orderPrefix} - ${itemName}`;

    // Append food coloring disclosure to ingredients and allergens if provided
    let ingredients = product.ingredients || '';
    let allergens = product.allergens || '';
    if (foodColoring) {
      ingredients += ` Food coloring: ${foodColoring}.`;
      const dyeKeywords = ['Red 40', 'Red 3', 'Blue 1', 'Blue 2', 'Green 3', 'Yellow 5', 'Yellow 6', 'Violet 1', 'FD&C'];
      const usedDyes = dyeKeywords.filter(d => foodColoring.toLowerCase().includes(d.toLowerCase()));
      if (usedDyes.length > 0 && !allergens.toLowerCase().includes('color')) {
        allergens += ` Contains artificial color(s): ${usedDyes.join(', ')}.`;
      }
    }

    const label = {
      id: labelId,
      name: labelName,
      shape: 'rounded',
      bg_color: '#FBF3E7',
      accent_color: '#C17A3F',
      text_color: '#4A3222',
      business_name: profile.name || 'Muy Rico',
      product_name: itemName,
      details: product.description || '',
      ingredients,
      allergens,
      net_weight: '',
      price: `$${(item.price || product.price).toFixed(2)}`,
      show_price: 1,
      show_best_by: 1,
      best_by_days: 7,
      logo_emoji: product.emoji || '🧁',
      logo_image: product.image_url || null,
      logo_size: 16,
      font: "'Cormorant Garamond', Georgia, serif",
      business_id_mode: 'registration',
      address: profile.address || '',
      phone_number: profile.phone || '',
      registration_number: profile.registration_number || '',
      show_disclaimer: 1,
      label_width: 3,
      label_height: 4,
      display_order: 0,
      elements: null,
      website_url: profile.website || 'https://muy-rico.com',
      orientation: 'portrait',
      disclaimer_variant: 'standard',
      product_type: 'standard',
      net_weight_us: '',
      net_weight_metric: '',
      allergen_tags: JSON.stringify(parseAllergenTags(allergens)),
      no_allergens_confirmed: 0,
      nutrient_claim: 0,
      bg_image: null,
      avery_preset: 'single',
      active: 1,
      best_by_date: new Date(Date.now() + (7 * 86400000)).toISOString().slice(0, 10),
    };

    const cols = ['id', ...LABEL_FIELDS, 'active'];
    const placeholders = cols.map(() => '?').join(', ');
    const binds = cols.map(c => label[c] ?? null);

    try {
      await env.DB.prepare(`INSERT INTO label_templates (${cols.join(', ')}) VALUES (${placeholders})`).bind(...binds).run();
    } catch(e) {
      console.error('Failed to auto-generate label:', e);
    }
  }
}

// Generate labels for a single order by ID (on-demand, for historical orders)
async function generateLabelsForOrderById(orderId, env) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ error: 'Order not found' }, 404);
  await generateLabelsForOrder(env, orderId, order);
  return json({ ok: true, orderId }, 200);
}

// Backfill labels for ALL past orders that don't already have labels
async function backfillAllOrderLabels(env) {
  const { results: orders } = await env.DB.prepare(
    `SELECT * FROM orders WHERE status NOT IN ('cancelled') ORDER BY id ASC`
  ).all();

  let generated = 0;
  for (const order of orders) {
    const before = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM label_templates WHERE name LIKE ?`
    ).bind(`MR-${order.id} - %`).first();
    const alreadyHasLabels = before && before.cnt > 0;
    if (!alreadyHasLabels) {
      await generateLabelsForOrder(env, order.id, order);
      generated++;
    }
  }
  return json({ ok: true, ordersProcessed: orders.length, labelsGenerated: generated }, 200);
}

async function uploadDataUrlToR2(dataUrl, env) {
  const [meta, b64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const ext = (mimeMatch ? mimeMatch[1].split('/')[1] : 'png').replace('jpeg', 'jpg');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = `labels/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await env.IMAGES_BUCKET.put(key, bin, { httpMetadata: { contentType: mimeMatch ? mimeMatch[1] : 'image/png' } });
  return `https://pub-${env.R2_PUBLIC_ID || '71c703c51efd43de8dde4439bd02a8af'}.r2.dev/${key}`;
}

async function listLabelTemplates(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM label_templates WHERE active = 1 ORDER BY display_order ASC, name ASC
  `).all();
  return json({ labelTemplates: results.map(snakeToCamelObject) }, 200);
}

async function getLabelTemplate(id, env) {
  const row = await env.DB.prepare('SELECT * FROM label_templates WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  return json({ labelTemplate: snakeToCamelObject(row) }, 200);
}

async function createLabelTemplate(request, env, actor) {
  const body = await request.json();
  if (!body.id || !body.name) return json({ error: 'Missing required fields: id, name' }, 400);
  if (typeof body.id !== 'string' || body.id.length > 64) return json({ error: 'id must be a short string' }, 400);
  if (body.logo_image && typeof body.logo_image === 'string' && body.logo_image.startsWith('data:')) {
    try {
      body.logo_image = await uploadDataUrlToR2(body.logo_image, env);
    } catch (e) { return json({ error: 'logo upload failed: ' + String(e) }, 400); }
  }
  const cols = ['id', ...LABEL_FIELDS];
  const placeholders = cols.map(() => '?').join(', ');
  const binds = [body.id];
  for (const f of LABEL_FIELDS) {
    let val = getBodyField(body, f) ?? null;
    if (f === 'show_price' || f === 'show_best_by' || f === 'show_disclaimer') val = val ? 1 : 0;
    if (f === 'best_by_days' || f === 'label_width' || f === 'label_height' || f === 'display_order') val = val === null || val === '' ? 0 : Number(val);
    if (f === 'elements' && typeof val === 'object' && val !== null) val = JSON.stringify(val);
    if (f === 'allergen_tags' && Array.isArray(val)) val = JSON.stringify(val);
    if (f === 'no_allergens_confirmed' || f === 'nutrient_claim' || f === 'show_price' || f === 'show_best_by' || f === 'show_disclaimer') val = val ? 1 : 0;
    if (f === 'best_by_days' || f === 'label_width' || f === 'label_height' || f === 'display_order') val = val === null || val === '' ? 0 : Number(val);
    binds.push(val);
  }
  try {
    await env.DB.prepare(`INSERT INTO label_templates (${cols.join(', ')}) VALUES (${placeholders})`).bind(...binds).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id: body.id }, 201);
}

async function updateLabelTemplate(id, request, env, actor) {
  const body = await request.json();
  if (body.logo_image && typeof body.logo_image === 'string' && body.logo_image.startsWith('data:')) {
    try {
      body.logo_image = await uploadDataUrlToR2(body.logo_image, env);
    } catch (e) { return json({ error: 'logo upload failed: ' + String(e) }, 400); }
  }
  const sets = [], binds = [];
  for (const f of LABEL_FIELDS) {
    const valInBody = getBodyField(body, f);
    if (valInBody === undefined) continue;
    let val = valInBody;
    if (f === 'show_price' || f === 'show_best_by' || f === 'show_disclaimer') val = val ? 1 : 0;
    if (f === 'best_by_days' || f === 'label_width' || f === 'label_height' || f === 'display_order') val = val === null || val === '' ? null : Number(val);
    if (f === 'elements' && typeof val === 'object' && val !== null) val = JSON.stringify(val);
    if (f === 'allergen_tags' && Array.isArray(val)) val = JSON.stringify(val);
    if (f === 'no_allergens_confirmed' || f === 'nutrient_claim' || f === 'show_price' || f === 'show_best_by' || f === 'show_disclaimer') val = val ? 1 : 0;
    if (f === 'best_by_days' || f === 'label_width' || f === 'label_height' || f === 'display_order') val = val === null || val === '' ? null : Number(val);
    sets.push(`${f} = ?`); binds.push(val);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE label_templates SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteLabelTemplate(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE label_templates SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Business profile (singleton) ────────────────────────────────────────────

const PROFILE_FIELDS = [
  'name', 'tagline', 'address', 'phone', 'email', 'website', 'registration_number',
  'accepted_methods', 'cashtag', 'venmo_handle', 'apple_pay_enabled', 'stripe_connected',
  'business_type',
];

async function getProfile(env) {
  const row = await env.DB.prepare("SELECT * FROM business_profile WHERE id = 'singleton'").first();
  if (!row) return json({ profile: null }, 200);
  return json({ profile: snakeToCamelObject(row) }, 200);
}

async function updateProfile(request, env, actor) {
  const body = await request.json();
  const cols = ['id', ...PROFILE_FIELDS];
  const binds = [];
  for (const f of PROFILE_FIELDS) {
    let val = getBodyField(body, f);
    if (f === 'apple_pay_enabled' || f === 'stripe_connected') val = val ? 1 : 0;
    if (f === 'accepted_methods' && typeof val === 'object') val = JSON.stringify(val);
    binds.push(val ?? null);
  }
  try {
    await env.DB.prepare(`
      INSERT INTO business_profile (${cols.join(', ')}) VALUES (?, ${PROFILE_FIELDS.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${PROFILE_FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')}, updated_at = datetime('now')
    `).bind('singleton', ...binds).run();
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
  return json({ ok: true }, 200);
}

// ─── Cake Quotes ────────────────────────────────────────────────────────────

const QUOTE_FIELDS = [
  'id', 'status', 'customer_name', 'email', 'phone', 'language',
  'occasion', 'serving_size', 'cake_flavor', 'filling', 'frosting',
  'toppings', 'dietary', 'reference_image_url',
  'comments', 'desired_date', 'budget',
  'quoted_price', 'admin_notes', 'converted_order_id',
  'created_at', 'updated_at',
];

function rowToQuote(r) {
  return {
    id: r.id,
    status: r.status,
    customer_name: r.customer_name,
    email: r.email,
    phone: r.phone,
    language: r.language || 'es',
    occasion: r.occasion,
    serving_size: r.serving_size,
    cake_flavor: r.cake_flavor,
    filling: r.filling,
    frosting: r.frosting,
    toppings: r.toppings ? JSON.parse(r.toppings) : [],
    dietary: r.dietary ? JSON.parse(r.dietary) : [],
    reference_image_url: r.reference_image_url,
    comments: r.comments,
    desired_date: r.desired_date,
    budget: r.budget,
    quoted_price: r.quoted_price,
    admin_notes: r.admin_notes,
    converted_order_id: r.converted_order_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    items: [], // placeholder, populated by getQuoteItems()
  };
}

async function createQuote(request, env, ctx) {
  try {
    const body = await request.json();
    if (!body.customer_name || !body.email) {
      return json({ error: 'Missing required fields: customer_name, email' }, 400);
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return json({ error: 'At least one item is required' }, 400);
    }

    // Validate product types
    const validTypes = ['cake', 'cakepops', 'cupcakes'];
    for (const item of body.items) {
      if (!item.product_type || !validTypes.includes(item.product_type)) {
        return json({ error: `Invalid product_type: ${item.product_type}. Must be cake, cakepops, or cupcakes` }, 400);
      }
      if (!item.details || typeof item.details !== 'object') {
        return json({ error: 'Item details must be an object' }, 400);
      }
    }

    // Extract cake_flavor from first item for back-compat
    const firstItemDetails = body.items[0].details;
    const cakeFlavor = firstItemDetails.cake_flavor || firstItemDetails.flavor || '';

    const toppings = Array.isArray(body.toppings) ? JSON.stringify(body.toppings) : '[]';
    const dietary = Array.isArray(body.dietary) ? JSON.stringify(body.dietary) : '[]';

    const result = await env.DB.prepare(`
      INSERT INTO cake_quotes
        (customer_name, email, phone, language, occasion, serving_size,
         cake_flavor, filling, frosting, toppings, dietary,
         reference_image_url, comments, desired_date, budget)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.customer_name.trim(),
      body.email.trim().toLowerCase(),
      body.phone || null,
      body.language || 'es',
      body.occasion || null,
      body.serving_size || null,
      cakeFlavor,
      body.filling || null,
      body.frosting || null,
      toppings,
      dietary,
      body.reference_image_url || null,
      body.comments || null,
      body.desired_date || null,
      body.budget || null,
    ).run();

    const quoteId = result.meta.last_row_id;

    // Insert items into cake_quote_items
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      await env.DB.prepare(`
        INSERT INTO cake_quote_items (quote_id, product_type, sort_order, details, reference_image_url)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        quoteId,
        item.product_type,
        i,
        JSON.stringify(item.details),
        item.reference_image_url || null,
      ).run();
    }

    // Notify admin
    ctx.waitUntil(notifyQuoteCreated(env, body, quoteId));

    // Send auto-reply to customer (ack, no price yet)
    ctx.waitUntil(sendQuoteAutoReply(env, body.email, body.language || 'es', quoteId, false));

    return json({ ok: true, id: quoteId }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function uploadQuoteImage(request, env) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return json({ error: 'No file provided' }, 400);
    }
    if (!ALLOWED_IMG.includes(file.type)) {
      return json({ error: 'Only JPG, PNG, or WEBP images allowed' }, 400);
    }
    if (file.size > MAX_IMG_BYTES) {
      return json({ error: 'Image must be 5MB or smaller' }, 400);
    }
    const ext = (file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const key = `quotes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await env.IMAGES_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    const url = `https://pub-${env.R2_PUBLIC_ID || '71c703c51efd43de8dde4439bd02a8af'}.r2.dev/${key}`;
    return json({ url }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function getQuoteItems(env, quoteIds) {
  if (!quoteIds.length) return {};
  const placeholders = quoteIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT * FROM cake_quote_items WHERE quote_id IN (${placeholders}) ORDER BY sort_order ASC`
  ).bind(...quoteIds).all();
  const itemsByQuote = {};
  for (const row of results) {
    if (!itemsByQuote[row.quote_id]) itemsByQuote[row.quote_id] = [];
    itemsByQuote[row.quote_id].push({
      id: row.id,
      product_type: row.product_type,
      details: JSON.parse(row.details),
      reference_image_url: row.reference_image_url,
    });
  }
  return itemsByQuote;
}

async function listQuotes(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes ORDER BY created_at DESC`
  ).all();
  const quotes = results.map(rowToQuote);
  const itemsByQuote = await getQuoteItems(env, quotes.map(q => q.id));
  for (const q of quotes) {
    q.items = itemsByQuote[q.id] || [];
  }
  return json({ quotes }, 200);
}

async function getQuote(id, env) {
  const row = await env.DB.prepare(
    `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
  ).bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  const quote = rowToQuote(row);
  const itemsByQuote = await getQuoteItems(env, [quote.id]);
  quote.items = itemsByQuote[quote.id] || [];
  return json(quote, 200);
}

async function updateQuote(id, request, env, ctx, actor) {
  try {
    const body = await request.json();
    const existing = await env.DB.prepare(
      `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
    ).bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);

    const sets = [];
    const binds = [];

    if (body.quoted_price !== undefined) {
      sets.push('quoted_price = ?');
      binds.push(body.quoted_price);
    }
    if (body.admin_notes !== undefined) {
      sets.push('admin_notes = ?');
      binds.push(body.admin_notes);
    }
    if (body.status !== undefined) {
      sets.push('status = ?');
      binds.push(body.status);
    }

    if (sets.length === 0) return json({ ok: true }, 200);

    sets.push("updated_at = datetime('now')");
    binds.push(id);

    await env.DB.prepare(
      `UPDATE cake_quotes SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    // If quoted_price changed from null → set, auto-send quote reply with price
    const oldPrice = existing.quoted_price;
    const newPrice = body.quoted_price !== undefined ? body.quoted_price : oldPrice;
    if (oldPrice == null && newPrice != null && existing.status === 'new') {
      await env.DB.prepare(
        "UPDATE cake_quotes SET status = 'replied', updated_at = datetime('now') WHERE id = ?"
      ).bind(id).run();

      ctx.waitUntil(sendQuoteAutoReply(env, existing.email, existing.language || 'es', id, true, newPrice));
      ctx.waitUntil(notifyQuoteReplied(env, id, existing.customer_name, newPrice));
    }

    if (body.status === 'archived' || body.status === 'converted') {
      // No auto-email when archiving
    }

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function convertQuote(id, request, env, ctx, actor) {
  try {
    const body = await request.json();
    const quote = await env.DB.prepare(
      `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
    ).bind(id).first();
    if (!quote) return json({ error: 'Quote not found' }, 404);

    if (quote.status === 'converted') {
      return json({ error: 'Quote already converted' }, 400);
    }
    if (quote.quoted_price == null) {
      return json({ error: 'Set quoted_price before converting' }, 400);
    }

    const depositCents = Number(body.deposit_amount_cents) || 0;
    const minDeposit = Math.ceil(quote.quoted_price * 0.5);
    if (depositCents < minDeposit) {
      return json({
        error: `Deposit must be at least 50% of quoted price ($${(minDeposit / 100).toFixed(2)})`,
      }, 400);
    }

    if (!ALLOWED_PAYMENT.includes(body.payment_method)) {
      return json({
        error: `Invalid payment_method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}`,
      }, 400);
    }

    const isFullPayment = depositCents >= quote.quoted_price;
    const paymentStatus = isFullPayment ? 'paid' : 'partial';

    // Build flavor note from quote details
    const flavorParts = [quote.cake_flavor];
    if (quote.filling) flavorParts.push(`Filling: ${quote.filling}`);
    if (quote.frosting) flavorParts.push(`Frosting: ${quote.frosting}`);
    if (quote.toppings) {
      try {
        const tp = typeof quote.toppings === 'string' ? JSON.parse(quote.toppings) : quote.toppings;
        if (Array.isArray(tp) && tp.length) flavorParts.push(`Toppings: ${tp.join(', ')}`);
      } catch {}
    }
    const flavorNote = flavorParts.join(' | ');

    // Build order notes — include quote reference + dietary + comments + image
    const orderNotes = [
      `From Quote #${id}`,
      quote.dietary ? `Dietary: ${JSON.parse(typeof quote.dietary === 'string' ? quote.dietary : '[]').join(', ')}` : '',
      quote.comments || '',
      quote.reference_image_url ? `Ref image: ${quote.reference_image_url}` : '',
    ].filter(Boolean).join('\n');

    // Create the order
    const itemsJson = JSON.stringify([{
      productId: 'prod_custom_cake',
      name: 'Custom Cake',
      emoji: '🎂',
      qty: 1,
      price: quote.quoted_price / 100,
      flavorNote,
    }]);

    const orderResult = await env.DB.prepare(`
      INSERT INTO orders
        (customer_name, phone, email, pickup_date, items_json,
         total_cents, payment_method, payment_status, status, notes,
         created_by, source, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'website', ?)
    `).bind(
      quote.customer_name,
      quote.phone,
      quote.email,
      quote.desired_date || new Date().toISOString().slice(0, 10),
      itemsJson,
      quote.quoted_price,
      body.payment_method,
      paymentStatus,
      orderNotes,
      actor,
      quote.language || 'es',
    ).run();

    const orderId = orderResult.meta.last_row_id;

    // Record deposit payment
    const payId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await env.DB.prepare(`
      UPDATE payments SET active = 0 WHERE order_id = ? AND active = 1
    `).bind(orderId).run();
    await env.DB.prepare(`
      INSERT INTO payments (id, order_id, customer_name, amount, method, date)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(payId, orderId, quote.customer_name, depositCents, body.payment_method).run();

    // Log event
    await env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:created')
    `).bind(orderId, actor).run();

    // Update quote
    await env.DB.prepare(`
      UPDATE cake_quotes SET status = 'converted', converted_order_id = ?,
        updated_at = datetime('now') WHERE id = ?
    `).bind(orderId, id).run();

    // Notify
    ctx.waitUntil(notifyQuoteConverted(env, id, quote.customer_name, orderId, depositCents, quote.quoted_price, body.payment_method));

    return json({ ok: true, order_id: orderId, payment_status: paymentStatus }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

// ─── Quote notifications ───────────────────────────────────────────────────

async function notifyQuoteCreated(env, body, id) {
  const itemsDetail = [
    body.occasion && `🎉 ${body.occasion}`,
    `🍰 ${body.cake_flavor}`,
    body.filling && `🥮 ${body.filling}`,
    body.frosting && `🍦 ${body.frosting}`,
  ].filter(Boolean).join(' · ');

  const msg = [
    `💬 New Quote #${id}`,
    `👤 ${body.customer_name}`,
    `📧 ${body.email}` + (body.phone ? ` · ${body.phone}` : ''),
    `📋 ${itemsDetail}`,
    body.desired_date ? `📅 Wants by: ${body.desired_date}` : '',
    body.comments ? `💭 "${body.comments.slice(0, 120)}"` : '',
  ].filter(Boolean).join('\n');

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }
  if (env.EMAIL_RECIPIENT && env.RESEND_API_KEY) {
    const html = `<div style="font-family: sans-serif; max-width: 480px; padding: 16px;">
  <h2 style="color: #333;">💬 New Quote #${id}</h2>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 6px 0; color: #555;"><strong>Customer</strong></td><td style="padding: 6px 0;">${body.customer_name}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Email</strong></td><td style="padding: 6px 0;">${body.email}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Cake</strong></td><td style="padding: 6px 0;">${body.cake_flavor}</td></tr>
    ${body.occasion ? `<tr><td style="padding: 6px 0; color: #555;"><strong>Occasion</strong></td><td style="padding: 6px 0;">${body.occasion}</td></tr>` : ''}
    ${body.comments ? `<tr><td style="padding: 6px 0; color: #555;"><strong>Comments</strong></td><td style="padding: 6px 0;">${body.comments.slice(0, 200)}</td></tr>` : ''}
  </table>
  <p style="color: #999; font-size: 12px; margin-top: 16px;">Quote #${id} · Muy Rico Bakery</p>
</div>`;
    const emails = String(env.EMAIL_RECIPIENT).split(',').map(e => e.trim()).filter(Boolean);
    await Promise.all(emails.map(email =>
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM || "orders@muy-rico.com",
          to: email,
          subject: `💬 New Cake Quote #${id} from ${body.customer_name}`,
          html,
        }),
      }).catch(e => console.error('Resend quote notify failed:', e))
    ));
  }
}

async function notifyQuoteReplied(env, id, customerName, priceCents) {
  const price = priceCents ? '$' + (priceCents / 100).toFixed(2) : '—';
  const msg = `📨 Quote #${id} replied — ${customerName} quoted at ${price}`;
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }
}

async function notifyQuoteConverted(env, id, customerName, orderId, depositCents, quotedCents, method) {
  const deposit = '$' + (depositCents / 100).toFixed(2);
  const total = '$' + (quotedCents / 100).toFixed(2);
  const methodLabel = method.charAt(0).toUpperCase() + method.slice(1);
  const msg = `🔄 Quote #${id} converted → Order #${orderId} (${customerName})\n💰 Deposit: ${deposit} via ${methodLabel} of ${total}`;
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }
}

async function sendQuoteAutoReply(env, email, lang, quoteId, includePrice, priceCents) {
  if (!email || !env.RESEND_API_KEY) return;

  const esAck = `¡Gracias por tu solicitud! Hemos recibido tu cotización personalizada de pastel #${quoteId}. Revisaremos los detalles y te enviaremos una cotización en 1-2 días hábiles. Si tienes preguntas, responde a este correo.`;
  const esPrice = `¡Tu cotización está lista! Hemos revisado tu solicitud de pastel personalizado #${quoteId} y nos encantaría hacerlo realidad.

Precio cotizado: $${(priceCents / 100).toFixed(2)}

Si deseas proceder, responde a este correo o haz tu pedido a través de nuestro sitio web. El precio puede variar según los detalles finales de personalización.

Gracias por elegir Muy Rico Bakery — ¡Familia · Tradición · Sabor!`;

  const enAck = `Thank you for your request! We've received your custom cake quote request #${quoteId}. We'll review the details and send you a quote within 1-2 business days. If you have questions, reply to this email.`;
  const enPrice = `Your quote is ready! We've reviewed your custom cake request #${quoteId} and would love to make it happen.

Quoted price: $${(priceCents / 100).toFixed(2)}

If you'd like to proceed, reply to this email or place your order through our website. The price may vary based on final customization details.

Thank you for choosing Muy Rico Bakery — Familia · Tradición · Sabor!`;

  const subject = includePrice
    ? (lang === 'es' ? `Cotización #${quoteId} — Muy Rico Bakery` : `Quote #${quoteId} — Muy Rico Bakery`)
    : (lang === 'es' ? `Solicitud #${quoteId} recibida — Muy Rico Bakery` : `Request #${quoteId} received — Muy Rico Bakery`);

  const body = includePrice ? (lang === 'es' ? esPrice : enPrice) : (lang === 'es' ? esAck : enAck);
  const html = body.replace(/\n/g, '<br>');

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "orders@muy-rico.com",
        to: email,
        subject,
        html: `<div style="font-family: sans-serif; max-width: 520px; padding: 24px; color: #2c2523; line-height: 1.6;">
  <div style="text-align: center; margin-bottom: 24px;">
    <img src="https://muy-rico.com/muy_rico_logo_email.png" alt="Muy Rico Bakery" style="max-width: 160px;">
  </div>
  <div>${html}</div>
  <hr style="border: none; border-top: 1px solid #e8dbc4; margin: 24px 0;">
  <p style="color: #706561; font-size: 12px; text-align: center;">
    Muy Rico Bakery · Holland, MI<br>
    ${lang === 'es' ? 'Famila · Tradición · Sabor' : 'Family · Tradition · Flavor'}
  </p>
</div>`,
      }),
    });
  } catch (e) {
    console.error('sendQuoteAutoReply failed:', e);
  }
}

// ─── Seed reset (re-runs INSERT OR IGNORE for the profile only) ──────────────

async function resetSeed(env, actor) {
  const seed = `
    INSERT OR IGNORE INTO business_profile
      (id, name, tagline, address, phone, email, registration_number,
       accepted_methods, cashtag, venmo_handle, apple_pay_enabled, stripe_connected)
    VALUES
      ('singleton','Muy Rico','Familia · Tradición · Sabor','Holland, MI','(616) 218-3582',
       'hello@muy-rico.com','',
       '{"stripe":false,"cashapp":true,"venmo":true,"applepay":true,"cash":true}',
       '$MuyRicoBakery','@Muy-Rico',1,0);
  `;
  try {
    await env.DB.exec(seed);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
  return json({ ok: true }, 200);
}
