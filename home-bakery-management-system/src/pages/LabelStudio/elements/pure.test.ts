import { describe, expect, it } from "vitest";
import { firstFamily } from "../capture";
import { frameGeometry } from "../StageCanvas";

describe("firstFamily", () => {
  it("extracts single-quoted first family", () => {
    expect(firstFamily("'Cormorant Garamond', Georgia, serif")).toBe(
      "Cormorant Garamond"
    );
  });

  it("extracts double-quoted first family", () => {
    expect(firstFamily('"Quicksand", sans-serif')).toBe("Quicksand");
  });

  it("falls back to first comma segment when unquoted", () => {
    expect(firstFamily("monospace")).toBe("monospace");
    expect(firstFamily("Poppins")).toBe("Poppins");
  });

  it("returns sans-serif for empty stack", () => {
    expect(firstFamily("")).toBe("sans-serif");
  });
});

describe("frameGeometry", () => {
  const unit = 1;

  it("circle: 6% pad, radius = outer.w/2, curved clip", () => {
    const g = frameGeometry(300, 400, "circle", unit);
    expect(g.isCurved).toBe(true);
    expect(g.pad).toBeCloseTo(18);
    expect(g.outer.x).toBeCloseTo(-18);
    expect(g.outer.y).toBeCloseTo(-18);
    expect(g.outer.w).toBeCloseTo(336);
    expect(g.outer.h).toBeCloseTo(436);
    expect(g.radius).toBeCloseTo(g.outer.w / 2);
  });

  it("rounded: 3% pad, radius = 12u, not curved", () => {
    const g = frameGeometry(300, 400, "rounded", unit);
    expect(g.isCurved).toBe(false);
    expect(g.pad).toBeCloseTo(9);
    expect(g.radius).toBeCloseTo(12);
    expect(g.outer.x).toBeCloseTo(-9);
    expect(g.outer.y).toBeCloseTo(-9);
    expect(g.outer.w).toBeCloseTo(318);
    expect(g.outer.h).toBeCloseTo(418);
  });

  it("square: 3% pad, radius = 8u", () => {
    const g = frameGeometry(300, 400, "square", 2);
    expect(g.pad).toBeCloseTo(9);
    expect(g.radius).toBeCloseTo(16);
    expect(g.isCurved).toBe(false);
  });

  it("oval: curved ellipse flag, zero corner radius, outer offset (-pad,-pad)", () => {
    const g = frameGeometry(300, 400, "oval", unit);
    expect(g.isCurved).toBe(true);
    expect(g.radius).toBe(0);
    expect(g.pad).toBeCloseTo(18);
    expect(g.outer.x).toBeCloseTo(-18);
    expect(g.outer.y).toBeCloseTo(-18);
    expect(g.outer.w).toBeCloseTo(336);
    expect(g.outer.h).toBeCloseTo(436);
  });
});
