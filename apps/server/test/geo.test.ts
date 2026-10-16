import { describe, expect, it } from "vitest";
import { bearing, haversine, inBBox, pointAlong } from "@trainfinder/shared";

describe("geo", () => {
  it("calcola distanze note", () => {
    // Milano Centrale - Roma Termini, circa 477 km in linea d'aria
    expect(haversine([9.2047, 45.4861], [12.5019, 41.9009]) / 1000).toBeCloseTo(477, -1);
  });

  it("calcola la rotta", () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90);
    expect(bearing([0, 1], [0, 0])).toBeCloseTo(180);
  });

  it("trova il punto lungo una polilinea", () => {
    const line: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ];
    const mid = pointAlong(line, 0.5);
    expect(mid.point[0]).toBeCloseTo(0, 3);
    expect(mid.point[1]).toBeCloseTo(1, 2);
    const q = pointAlong(line, 0.75);
    expect(q.point[1]).toBeCloseTo(1, 3);
    expect(q.bearing).toBeGreaterThan(80);
    expect(pointAlong(line, 2).point).toEqual([1, 1]);
  });

  it("gestisce bbox che attraversano l'antimeridiano", () => {
    expect(inBBox(179, 0, [170, -10, -170, 10])).toBe(true);
    expect(inBBox(0, 0, [170, -10, -170, 10])).toBe(false);
    expect(inBBox(10, 45, [5, 40, 15, 50])).toBe(true);
  });
});
