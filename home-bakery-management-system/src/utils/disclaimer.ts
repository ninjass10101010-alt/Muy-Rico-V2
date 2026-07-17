export const DISCLAIMER_STANDARD =
  "Made in a home kitchen that has not been inspected by the Michigan Department of Agriculture and Rural Development.";

export function disclaimerText(_variant?: string, _productType?: string): string {
  return DISCLAIMER_STANDARD;
}
