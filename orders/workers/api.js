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
  async fetch(request, env) {
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

    if (!actorEmail && !isLocal && !isPublicPost && !isPublicProductGet) {
      return json({ error: 'Unauthorized — Cloudflare Access required' }, 401);
    }

    if (isPublicPost && !actorEmail && !isLocal) {
      actorName = 'website';
    }

    try {
      if (path === '/api/orders' && method === 'POST')  return await createOrder(request, env, actorName);
      if (path === '/api/orders' && method === 'GET')   return await listOrders(request, env, actorName);
      if (path === '/api/stats'  && method === 'GET')   return await getStats(env, actorName);
      if (path === '/api/products' && method === 'GET') return await listProducts(env);
      if (path === '/api/products' && method === 'POST') return await createProduct(request, env, actorName);
      if (path === '/api/inventory' && method === 'GET') return await listInventory(env);
      if (path === '/api/inventory' && method === 'POST') return await createInventory(request, env, actorName);

      const om = path.match(/^\/api\/orders\/(\d+)$/);
      if (om) {
        const id = Number(om[1]);
        if (method === 'GET')    return await getOrder(id, env, actorName);
        if (method === 'PATCH')  return await updateOrder(id, request, env, actorName);
        if (method === 'DELETE') return await cancelOrder(id, env, actorName);
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



async function createOrder(request, env, actor) {
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

  const result = await env.DB.prepare(`
    INSERT INTO orders
      (customer_name, phone, pickup_date, pickup_time,
       items_json, total_cents, payment_method, payment_status, status, notes, created_by, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.customer_name.trim(),
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
  ).run();

  const id = result.meta.last_row_id;
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:created')
  `).bind(id, actor).run();

  // Fire notifications in the background (don't block response)
  notifyOrderCreated(env, body, id, actor);

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
  const allowed = ['status', 'payment_status', 'notes', 'pickup_date', 'pickup_time', 'payment_method'];
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

async function cancelOrder(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:cancelled')
  `).bind(id, actor).run();
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
    const flavorGroups = safeJsonParse(r.flavors, []);
    return {
      ...r,
      flavor_groups: flavorGroups,  // canonical new name
      flavors: flavorGroups,         // legacy alias for any old reader
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
  const flavorGroups = safeJsonParse(row.flavors, []);
  const product = {
    ...row,
    flavor_groups: flavorGroups,
    flavors: flavorGroups,
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
  'flavors', 'recipe', 'display_order', 'auto_generate_label',
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
         sku, emoji, image_url, active, ingredients, allergens, flavors, recipe, display_order, auto_generate_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const body = await request.json();
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
