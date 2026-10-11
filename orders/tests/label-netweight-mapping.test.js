import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

const LABEL_ROW = {
  id: 'label_x',
  name: 'MR-1 - Test',
  active: 1,
  display_order: 0,
  net_weight_us: '3 oz',
  net_weight_metric: '85 g',
  best_by_days: 7,
  label_width: 3,
  label_height: 4,
};

function makeEnv(labelRow) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() { calls.push({ sql, binds: stmt._binds, method: 'first' }); return labelRow ?? null; },
        async run() { calls.push({ sql, binds: stmt._binds, method: 'run' }); return { meta: { changes: 1 } }; },
        async all() { calls.push({ sql, binds: stmt._binds, method: 'all' }); return { results: labelRow ? [labelRow] : [] }; },
      };
      return stmt;
    },
    async batch(stmts) { return stmts.map(() => ({ meta: { changes: 1 } })); },
  };
  const env = { DB: db };
  const ctx = { waitUntil: () => {} };
  return { env, ctx, calls };
}

describe('label net weight API mapping', () => {
  it('returns netWeightUS and netWeightMetric to the client', async () => {
    const { env, ctx } = makeEnv(LABEL_ROW);
    const res = await worker.fetch(new Request('http://localhost/api/labels'), env, ctx);
    const body = await res.json();
    expect(body.labelTemplates[0].netWeightUS).toBe('3 oz');
    expect(body.labelTemplates[0].netWeightMetric).toBe('85 g');
  });

  it('persists netWeightUS sent by the client', async () => {
    const { env, ctx, calls } = makeEnv(LABEL_ROW);
    const res = await worker.fetch(new Request('http://localhost/api/labels/label_x', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ netWeightUS: '3 oz (85 g) each' }),
    }), env, ctx);
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.method === 'run' && /UPDATE label_templates/.test(c.sql));
    expect(update, 'the PATCH must reach the label update').toBeTruthy();
    expect(update.sql).toMatch(/net_weight_us = \?/);
    expect(update.binds).toContain('3 oz (85 g) each');
  });
});
