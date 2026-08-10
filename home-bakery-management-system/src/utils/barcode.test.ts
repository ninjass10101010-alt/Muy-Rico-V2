import { describe, it, expect } from "vitest";
import { sanitizeBarcode } from "./barcode";

describe("sanitizeBarcode (client mirror)", () => {
  it("validates a correct EAN-13 check digit", () => {
    expect(sanitizeBarcode("5901234123457")).toMatchObject({ code: "5901234123457", valid: true, format: "EAN13" });
  });
  it("rejects a wrong EAN-13 check digit", () => {
    expect(sanitizeBarcode("5901234123458")).toMatchObject({ code: "5901234123458", valid: false, format: "EAN13" });
  });
  it("validates a correct UPC-A check digit", () => {
    expect(sanitizeBarcode("036000291452")).toMatchObject({ code: "036000291452", valid: true, format: "UPC-A" });
  });
  it("strips AIM prefixes, GS separators, and whitespace", () => {
    expect(sanitizeBarcode("]C1\u001d5901234123457")).toMatchObject({ code: "5901234123457", valid: true });
    expect(sanitizeBarcode(" 590 123 412 3457 ")).toMatchObject({ code: "5901234123457", valid: true });
  });
  it("unwraps a GS1 (01) application identifier", () => {
    expect(sanitizeBarcode("(01)5901234123457")).toMatchObject({ code: "5901234123457", valid: true });
  });
  it("leaves non-numeric internal codes untouched (no digits verdict)", () => {
    expect(sanitizeBarcode("inv_flour")).toMatchObject({ code: null, valid: false, format: "non-numeric" });
  });
  it("returns null code for empty input", () => {
    expect(sanitizeBarcode("   ").code).toBeNull();
    expect(sanitizeBarcode("").code).toBeNull();
  });
  it("flags short numeric codes as unvalidatable, not valid", () => {
    expect(sanitizeBarcode("12345")).toMatchObject({ code: "12345", valid: false, format: "unknown" });
  });
});
