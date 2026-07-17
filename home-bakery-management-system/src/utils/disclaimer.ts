export const DISCLAIMER_STANDARD =
  "Made in a home kitchen that has not been inspected by the Michigan Department of Agriculture and Rural Development.";

export function disclaimerText(variant: string, productType: string): string {
  if (productType === "wedding") return DISCLAIMER_MAPLE;
  return DISCLAIMER_STANDARD;
}
