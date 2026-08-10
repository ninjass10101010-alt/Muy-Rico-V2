// Client-side mirror of orders/workers/enrich-lib.js sanitizeBarcode.
// Kept in sync manually; both files are covered by the same test vectors.

export interface BarcodeVerdict {
  code: string | null;      // sanitized digits, or null when the input has none
  raw: string;
  stripped: string;
  digits: string;
  valid: boolean;           // false when format is unknown OR check digit fails
  format: 'EAN8' | 'UPC-A' | 'EAN13' | 'ITF14' | 'unknown' | 'non-numeric';
}

export function sanitizeBarcode(raw: string | null | undefined): BarcodeVerdict {
  const input = String(raw == null ? '' : raw);
  let stripped = input;
  const gs1 = stripped.match(/^\(\s*0*1\s*\)\s*(\d{12,14})$/);
  if (gs1) stripped = gs1[1];
  stripped = stripped
    .replace(/^\s*\]c\d/gi, '')
    .replace(/^\s*\]e\d/gi, '')
    .replace(/[\u001d\u001e\u001f]/g, '')
    .replace(/\s+/g, '');
  const digits = stripped.replace(/\D/g, '');
  if (!digits) {
    return { code: null, raw: input, stripped, digits: '', valid: false, format: 'non-numeric' };
  }
  let format: BarcodeVerdict['format'] = 'unknown';
  if (digits.length === 8) format = 'EAN8';
  else if (digits.length === 12) format = 'UPC-A';
  else if (digits.length === 13) format = 'EAN13';
  else if (digits.length === 14) format = 'ITF14';
  const valid = ['EAN8', 'UPC-A', 'EAN13', 'ITF14'].includes(format) && mod10CheckDigitValid(digits);
  return { code: digits, raw: input, stripped, digits, valid, format };
}

function mod10CheckDigitValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[i]);
    const posFromRight = digits.length - 1 - i;
    sum += posFromRight % 2 === 1 ? d * 3 : d;
  }
  return sum % 10 === 0;
}
