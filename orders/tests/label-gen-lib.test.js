import { describe, it, expect } from 'vitest';
import {
  buildSubItems,
  cleanSubItemDetail,
  matchProductForName,
  matchProductForSubItem,
  expandOrderLineItems,
} from '../workers/label-gen-lib.js';

const PRODUCTS = [
  { id: 'prod_mrwvp8n0', name: 'Cinnamon Rolls', auto_generate_label: 1 },
  { id: 'prod_cookie', name: 'Cookies', auto_generate_label: 1 },
  { id: 'prod_cupcakes', name: 'Cupcakes (6)', auto_generate_label: 1 },
  { id: 'prod_mini_cupcakes', name: 'Mini Cupcakes (12)', auto_generate_label: 1 },
  { id: 'prod_custom_cake', name: 'Custom Cake', auto_generate_label: 1 },
  { id: 'prod_cakepop', name: 'Cakepops', auto_generate_label: 1 },
];

const QUOTE_19_ITEMS = [
  { product_type: 'custom', details: { name: 'Lemon cupcake', description: 'Vanilla frosting', quantity: 24 } },
  { product_type: 'custom', details: { name: 'Fun fetty cupcake', description: 'vanilla frosting', quantity: 24 } },
  { product_type: 'cupcakes', details: { cake_flavor: 'Strawberry', frosting: 'Vanilla Frosting', quantity: 12 } },
  { product_type: 'custom', details: { name: 'Delivery service', description: '$20 for delivery from Holland to Grand Rapids.', quantity: 1 } },
];

const QUOTE_18_ITEMS = [
  { product_type: 'custom', details: { name: 'Cinnamon Rolls', description: 'Cinnamon Rolls Dubai Chocolate (4)', quantity: 4 } },
  { product_type: 'custom', details: { name: 'Cinnamon Rolls', description: 'Regular cinnamon rolls (4)', quantity: 4 } },
];

const combinedLine = (subItems) => [
  { productId: null, name: 'combined', qty: 1, price: 120, flavorNote: '…', subItems },
];

describe('buildSubItems', () => {
  it('maps quote items to label sub-items', () => {
    expect(buildSubItems(QUOTE_19_ITEMS)).toEqual([
      { type: 'custom', name: 'Lemon cupcake', qty: 24, details: QUOTE_19_ITEMS[0].details },
      { type: 'custom', name: 'Fun fetty cupcake', qty: 24, details: QUOTE_19_ITEMS[1].details },
      { type: 'cupcakes', name: 'Cupcakes (Vanilla Frosting)', qty: 12, details: QUOTE_19_ITEMS[2].details },
      { type: 'custom', name: 'Delivery service', qty: 1, details: QUOTE_19_ITEMS[3].details },
    ]);
  });

  it('returns an empty array when there are no quote items', () => {
    expect(buildSubItems([])).toEqual([]);
  });
});

describe('matchProductForName', () => {
  it('matches a product name contained in the item name', () => {
    expect(matchProductForName('Cinnamon Rolls ×4', PRODUCTS)?.id).toBe('prod_mrwvp8n0');
  });

  it('prefers the longest contained product name', () => {
    expect(matchProductForName('Mini Cinnamon Rolls', [
      { id: 'reg', name: 'Cinnamon Rolls' },
      { id: 'mini', name: 'Mini Cinnamon Rolls' },
    ])?.id).toBe('mini');
  });

  it('returns null when no product name is contained', () => {
    expect(matchProductForName('Lemon cupcake', PRODUCTS)).toBeNull();
    expect(matchProductForName('Delivery service', PRODUCTS)).toBeNull();
    expect(matchProductForName('', PRODUCTS)).toBeNull();
  });
});

describe('matchProductForSubItem', () => {
  it('maps the quote item type to its catalog product', () => {
    expect(matchProductForSubItem({ type: 'cupcakes', name: 'Cupcakes (Vanilla Frosting)' }, PRODUCTS)?.id).toBe('prod_cupcakes');
    expect(matchProductForSubItem({ type: 'cake', name: 'Custom Cake — Red Velvet' }, PRODUCTS)?.id).toBe('prod_custom_cake');
    expect(matchProductForSubItem({ type: 'cakepops', name: 'Cakepops (White, Sprinkles)' }, PRODUCTS)?.id).toBe('prod_cakepop');
  });

  it('falls back to the item name for custom entries', () => {
    expect(matchProductForSubItem({ type: 'custom', name: 'Cinnamon Rolls' }, PRODUCTS)?.id).toBe('prod_mrwvp8n0');
  });

  it('fuzzy-matches custom cupcake names against plural product names', () => {
    expect(matchProductForSubItem({ type: 'custom', name: 'Lemon cupcake' }, PRODUCTS)?.id).toBe('prod_cupcakes');
    expect(matchProductForSubItem({ type: 'custom', name: 'Fun fetty cupcake' }, PRODUCTS)?.id).toBe('prod_cupcakes');
    expect(matchProductForSubItem({ type: 'custom', name: 'Mini cupcakes' }, PRODUCTS)?.id).toBe('prod_mini_cupcakes');
  });

  it('returns null for services', () => {
    expect(matchProductForSubItem({ type: 'custom', name: 'Delivery service' }, PRODUCTS)).toBeNull();
  });
});

describe('cleanSubItemDetail', () => {
  it('strips the repeated item name and a trailing pack count', () => {
    expect(cleanSubItemDetail({ type: 'custom', name: 'Cinnamon Rolls', details: { description: 'Cinnamon Rolls Dubai Chocolate (4)' } })).toBe('Dubai Chocolate');
    expect(cleanSubItemDetail({ type: 'custom', name: 'Cinnamon Rolls', details: { description: 'Regular cinnamon rolls (4)' } })).toBe('Regular');
  });

  it('keeps a plain description', () => {
    expect(cleanSubItemDetail({ type: 'custom', name: 'Lemon cupcake', details: { description: 'Vanilla frosting' } })).toBe('Vanilla frosting');
  });

  it('uses the cake flavor for typed cupcakes', () => {
    expect(cleanSubItemDetail({ type: 'cupcakes', name: 'Cupcakes (Vanilla Frosting)', details: { cake_flavor: 'Strawberry', frosting: 'Vanilla Frosting' } })).toBe('Strawberry');
  });

  it('returns an empty string when there is nothing useful', () => {
    expect(cleanSubItemDetail({ type: 'custom', name: 'Cookies', details: {} })).toBe('');
  });
});

describe('expandOrderLineItems', () => {
  it('splits a quote-converted line into one label per food sub-item', () => {
    const entries = expandOrderLineItems(combinedLine(buildSubItems(QUOTE_19_ITEMS)), PRODUCTS);
    expect(entries.map((e) => e.displayName)).toEqual([
      'Lemon cupcake (Vanilla frosting) ×24',
      'Fun fetty cupcake (vanilla frosting) ×24',
      'Cupcakes (Vanilla Frosting) (Strawberry) ×12',
    ]);
    expect(entries.map((e) => e.product.id)).toEqual(['prod_cupcakes', 'prod_cupcakes', 'prod_cupcakes']);
    expect(entries.every((e) => e.isSubItem)).toBe(true);
    expect(entries.every((e) => e.showPrice === 0)).toBe(true);
  });

  it('keeps distinct labels for two same-named custom items', () => {
    const entries = expandOrderLineItems(combinedLine(buildSubItems(QUOTE_18_ITEMS)), PRODUCTS);
    expect(entries.map((e) => e.displayName)).toEqual([
      'Cinnamon Rolls (Dubai Chocolate) ×4',
      'Cinnamon Rolls (Regular) ×4',
    ]);
    expect(entries.map((e) => e.product.id)).toEqual(['prod_mrwvp8n0', 'prod_mrwvp8n0']);
  });

  it('disambiguates identical label names deterministically', () => {
    const subs = [
      { type: 'custom', name: 'Cookies', qty: 1, details: {} },
      { type: 'custom', name: 'Cookies', qty: 1, details: {} },
    ];
    const entries = expandOrderLineItems(combinedLine(subs), PRODUCTS);
    expect(entries.map((e) => e.displayName)).toEqual(['Cookies', 'Cookies (2)']);
  });

  it('passes a normal website line through unchanged', () => {
    const entries = expandOrderLineItems([
      { productId: 'prod_cupcakes', name: 'Cupcakes (6) (Cupcake flavor: Chocolate)', qty: 2, price: 18 },
    ], PRODUCTS);
    expect(entries).toHaveLength(1);
    expect(entries[0].displayName).toBe('Cupcakes (6) (Cupcake flavor: Chocolate)');
    expect(entries[0].product.id).toBe('prod_cupcakes');
    expect(entries[0].isSubItem).toBe(false);
    expect(entries[0].showPrice).toBeUndefined();
  });

  it('skips a combined line with no sub-items and no product match', () => {
    const entries = expandOrderLineItems([
      { productId: null, name: 'Lemon cupcake ×24 + Fun fetty cupcake ×24 + Delivery service', qty: 1, price: 120 },
    ], PRODUCTS);
    expect(entries).toEqual([]);
  });

  it('skips sub-items that do not resolve to a product', () => {
    const entries = expandOrderLineItems(combinedLine([
      { type: 'custom', name: 'Delivery service', qty: 1, details: {} },
      { type: 'custom', name: 'Setup fee', qty: 1, details: {} },
    ]), PRODUCTS);
    expect(entries).toEqual([]);
  });
});
