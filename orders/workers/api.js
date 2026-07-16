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

const ALLOWED_PAYMENT = ['venmo', 'cashapp', 'applepay', 'cash', 'stripe'];
const ALLOWED_STATUS  = ['pending', 'in-progress', 'ready', 'completed', 'done', 'cancelled'];
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
    // Internal mark-paid endpoint: public (no Cloudflare Access) but authenticated
    // by the shared X-Webhook-Secret header inside markOrderPaid().
    const isPublicMarkPaid =
      path.match(/^\/api\/orders\/\d+\/mark-paid$/) && method === 'POST';

    if (!actorEmail && !isLocal && !isPublicPost && !isPublicProductGet && !isPublicMarkPaid) {
      return json({ error: 'Unauthorized — Cloudflare Access required' }, 401);
    }

    if (isPublicPost && !actorEmail && !isLocal) {
      actorName = 'website';
    }

    try {
      if (path === '/api/orders' && method === 'POST')  return await createOrder(request, env, ctx, actorName);
      if (path === '/api/orders' && method === 'GET')   return await listOrders(request, env, actorName);
      if (path === '/api/stats'  && method === 'GET')   return await getStats(env, actorName);
      if (path === '/api/products' && method === 'GET') return await listProducts(env);
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
        return await markOrderPaid(Number(mpm[1]), request, env);
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
      (customer_name, customer_id, phone, pickup_date, pickup_time,
       items_json, total_cents, payment_method, payment_status, status, notes, created_by, source, food_coloring)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.customer_name.trim(),
    customerId,
    body.phone || null,
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
    body.food_coloring?.trim() || null,
  ).run();

  const id = result.meta.last_row_id;
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:created')
  `).bind(id, actor).run();

  // Fire notifications in the background (don't block response)
  notifyOrderCreated(env, body, id, actor);

  // Auto-generate labels in the background
  ctx.waitUntil(generateLabelsForOrder(env, id, body));

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
  const msg = `🆕 Order #${id}\n👤 ${customer}\n📦 ${itemsStr}\n💰 ${total}\n📅 ${date} ${time}\n💳 ${body.payment_method}\n👤 by ${actor}`;

  // Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }

  // Email
  if (env.EMAIL_RECIPIENT && env.EMAIL && env.EMAIL.send) {
    notifyEmail(env, msg, id);
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

async function notifyEmail(env, msg, id) {
  try {
    const emails = String(env.EMAIL_RECIPIENT).split(',').map(e => e.trim()).filter(Boolean);
    await env.EMAIL.send({
      from: env.EMAIL_FROM || 'orders@muy-rico.bakery',
      to: emails,
      subject: `🆕 Order #${id} — New Muy Rico Order`,
      text: msg,
    });
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
  const allowed = ['status', 'payment_status', 'notes', 'pickup_date', 'pickup_time', 'payment_method', 'food_coloring'];
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

  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:updated')
  `).bind(id, actor).run();

  return json({ ok: true }, 200);
}

async function markOrderPaid(id, request, env) {
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

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);

  // Idempotent: already paid with the same method → no-op (still log the event below)
  const alreadyPaid = order.payment_status === 'paid' && order.payment_method === method;

  if (!alreadyPaid) {
    await env.DB.prepare(`
      UPDATE orders SET payment_status = 'paid', payment_method = ? WHERE id = ?
    `).bind(method, id).run();
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
    const amount = Number(order.total_cents) || 0;
    await env.DB.prepare(`
      INSERT INTO payments (id, order_id, customer_name, amount, method, date, created_at, active)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
    `).bind(payId, id, customerName, amount, method).run();
  }

  if (alreadyPaid) return json({ ok: true, skipped: 'already-paid' }, 200);
  return json({ ok: true }, 200);
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
    FROM orders
  `).all();
  return json(results[0] || {}, 200);
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

const ALLOWED_IMG = ['image/jpeg', 'image/png', 'image/webp'];
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

async function listProducts(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM products
    WHERE active = 1
    ORDER BY display_order ASC, name ASC
  `).all();
  const products = (results || []).map(r => {
    const flavorGroups = migrateFlavorGroups(safeJsonParse(r.flavors, []));
    return {
      ...r,
      flavor_groups: flavorGroups,  // canonical new name
      flavors: flavorGroups,         // legacy alias for any old reader
      pack_sizes: safeJsonParse(r.pack_sizes, []),
      recipe: safeJsonParse(r.recipe, []),
      active: Boolean(r.active),
      auto_generate_label: Boolean(r.auto_generate_label),
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
  };
  return json({ product }, 200);
}

const PRODUCT_FIELDS = [
  'name', 'name_es', 'description', 'description_es', 'category',
  'price', 'cost', 'sku', 'emoji', 'image_url',
  'active', 'ingredients', 'allergens',
  'flavors', 'pack_sizes', 'recipe', 'display_order', 'auto_generate_label',
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
         sku, emoji, image_url, active, ingredients, allergens, flavors, pack_sizes, recipe, display_order, auto_generate_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    if (f === 'active') val = val ? 1 : 0;
    if (f === 'flavors') val = parseFlavors(body.flavor_groups || body.flavors || []);
    if (f === 'pack_sizes') val = parseFlavors(body.pack_sizes || []);
    if (f === 'recipe')  val = parseRecipe(val);
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
  try {
    await env.DB.prepare(`
      INSERT INTO payments (id, order_id, order_number, customer_name, amount, method, date, created_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
    `).bind(
      body.id,
      getBodyField(body, 'order_id') ?? null,
      getBodyField(body, 'order_number') || null,
      customerName,
      Number(body.amount) || 0,
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
  'show_price', 'show_best_by', 'best_by_days', 'logo_emoji', 'logo_image', 'logo_size',
  'font', 'business_id_mode', 'address', 'phone_number', 'registration_number',
  'show_disclaimer', 'label_width', 'label_height', 'display_order',
];

async function generateLabelsForOrder(env, orderId, body) {
  let items = [];
  try {
    items = typeof body.items_json === 'string' ? JSON.parse(body.items_json) : body.items_json;
  } catch(e) { return; }

  const profileRow = await env.DB.prepare("SELECT * FROM business_profile WHERE id = 'singleton'").first();
  const profile = profileRow || {};
  const foodColoring = (body.food_coloring || '').trim();
  const orderId_str = `Order #${orderId}`;

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

    // Skip if label already exists for this order + product
    const existing = await env.DB.prepare(
      `SELECT id FROM label_templates WHERE name = ? LIMIT 1`
    ).bind(`${orderId_str} - ${product.name}`).first();
    if (existing) continue;

    const labelId = `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const labelName = `${orderId_str} - ${product.name}`;

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
      product_name: product.name,
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
      active: 1
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
    ).bind(`Order #${order.id} - %`).first();
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
  'name', 'tagline', 'address', 'phone', 'email', 'registration_number',
  'accepted_methods', 'cashtag', 'venmo_handle', 'apple_pay_enabled', 'stripe_connected',
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
