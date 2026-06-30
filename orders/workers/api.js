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
// Access: all routes require a Cloudflare Access session.
// Cloudflare injects the authenticated user email as cf-access-authenticated-user-email.
// We trust that header (Access blocks unauthenticated requests at the edge).

const ALLOWED_PAYMENT = ['venmo', 'cashapp', 'applepay', 'cash'];
const ALLOWED_STATUS  = ['pending', 'ready', 'done', 'cancelled'];
const ALLOWED_PAYSTAT = ['unpaid', 'paid'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') return new Response(null, { status: 204 });

    // --- Access check ---
    const actorEmail = request.headers.get('cf-access-authenticated-user-email') || '';
    const actorName  = actorEmail.split('@')[0] || 'unknown';
    if (!actorEmail) {
      return json({ error: 'Unauthorized — Cloudflare Access required' }, 401);
    }

    try {
      if (path === '/api/orders' && method === 'POST')  return await createOrder(request, env, actorName);
      if (path === '/api/orders' && method === 'GET')   return await listOrders(request, env, actorName);
      if (path === '/api/stats'  && method === 'GET')   return await getStats(env, actorName);

      const m = path.match(/^\/api\/orders\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if (method === 'GET')    return await getOrder(id, env, actorName);
        if (method === 'PATCH')  return await updateOrder(id, request, env, actorName);
        if (method === 'DELETE') return await cancelOrder(id, env, actorName);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Server error', detail: String(err) }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

  const items = typeof body.items_json === 'string' ? body.items_json : JSON.stringify(body.items_json);

  const result = await env.DB.prepare(`
    INSERT INTO orders
      (customer_name, phone, pickup_date, pickup_time,
       items_json, total_cents, payment_method, payment_status, status, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  ).run();

  const id = result.meta.last_row_id;
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:created')
  `).bind(id, actor).run();

  return json({ ok: true, id }, 201);
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
      SUM(CASE WHEN status IN ('pending','ready') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'ready'   THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN status = 'done'    THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN payment_status = 'unpaid' AND status != 'cancelled' THEN 1 ELSE 0 END) AS unpaid,
      SUM(CASE WHEN payment_status = 'paid'   THEN 1 ELSE 0 END) AS paid
    FROM orders
  `).all();
  return json(results[0] || {}, 200);
}
