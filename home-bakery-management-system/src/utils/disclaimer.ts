export const DISCLAIMER_STANDARD =
  "Made in a home kitchen that has not been inspected by the Michigan Department of Agriculture and Rural Development.";

export const DISCLAIMER_MAPLE =
  "Processed in a facility not inspected by the Michigan Department of Agriculture and Rural Development.";

export const DISCLAIMER_HONEY = DISCLAIMER_MAPLE;

export function disclaimerText(variant: string, productType: string): string {
  if (variant === "maple" || variant === "honey") return DISCLAIMER_MAPLE;
  if (productType === "maple" || productType === "honey") return DISCLAIMER_MAPLE;
  return DISCLAIMER_STANDARD;
}
