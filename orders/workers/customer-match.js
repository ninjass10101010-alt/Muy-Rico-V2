// orders/workers/customer-match.js
// Pure functions for customer normalization and duplicate detection.

export function normalizeEmail(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
}

export function normalizePhone(s) {
  if (!s || typeof s !== 'string') return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null;
  // Strip leading US country code if 11 digits
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

export function normalizeName(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim().toLowerCase();
  if (!trimmed) return null;
  // Strip diacritics (accents)
  const stripped = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Collapse whitespace
  return stripped.replace(/\s+/g, ' ');
}

export function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  const tokensA = new Set(na.split(' '));
  const tokensB = new Set(nb.split(' '));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  let intersection = 0;
  for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Check if a new customer matches an existing one.
// Returns null (no match) or { existingId, existingName, matchedBy }.
export function matchCustomer(newCust, existingCustomers) {
  const emailNorm = normalizeEmail(newCust.email);
  const phoneNorm = normalizePhone(newCust.phone);
  const nameNorm = normalizeName(newCust.name);

  for (const c of existingCustomers) {
    if (c.active !== 1) continue;

    // Rule 1: Exact email match
    if (emailNorm && c.emailNormalized && emailNorm === c.emailNormalized) {
      return { existingId: c.id, existingName: c.name, matchedBy: 'email_exact' };
    }

    // Rule 2: Phone match + name similarity ≥ 0.5
    if (phoneNorm && c.phoneNormalized && phoneNorm === c.phoneNormalized) {
      if (nameSimilarity(newCust.name, c.name) >= 0.5) {
        return { existingId: c.id, existingName: c.name, matchedBy: 'phone_exact' };
      }
    }

    // Rule 3: Exact name with no email and no phone on either
    if (nameNorm && !emailNorm && !phoneNorm && !c.emailNormalized && !c.phoneNormalized) {
      if (nameNorm === normalizeName(c.name)) {
        return { existingId: c.id, existingName: c.name, matchedBy: 'name_exact' };
      }
    }
  }
  return null;
}

// Find all suspected duplicate pairs among active customers.
// Returns array sorted by confidence: high (email) > medium (phone+name) > low (name-only).
export function findDuplicates(customers) {
  const active = customers.filter(c => c.active === 1 && !c.mergedIntoId);
  const pairs = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      const emailNormA = normalizeEmail(a.email);
      const emailNormB = normalizeEmail(b.email);
      const phoneNormA = normalizePhone(a.phone);
      const phoneNormB = normalizePhone(b.phone);

      // Rule 1: email exact
      if (emailNormA && emailNormB && emailNormA === emailNormB) {
        pairs.push({ survivingCandidate: a, mergedCandidate: b, matchedBy: 'email_exact', confidence: 'high' });
        continue;
      }

      // Rule 2: phone + name
      if (phoneNormA && phoneNormB && phoneNormA === phoneNormB) {
        if (nameSimilarity(a.name, b.name) >= 0.5) {
          pairs.push({ survivingCandidate: a, mergedCandidate: b, matchedBy: 'phone_exact', confidence: 'medium' });
          continue;
        }
      }

      // Rule 3: exact name, no email, no phone
      const nameA = normalizeName(a.name);
      const nameB = normalizeName(b.name);
      if (nameA && nameB && nameA === nameB && !emailNormA && !emailNormB && !phoneNormA && !phoneNormB) {
        pairs.push({ survivingCandidate: a, mergedCandidate: b, matchedBy: 'name_exact', confidence: 'low' });
      }
    }
  }

  // Sort: high confidence first
  const order = { high: 0, medium: 1, low: 2 };
  pairs.sort((x, y) => (order[x.confidence] ?? 3) - (order[y.confidence] ?? 3));
  return pairs;
}
