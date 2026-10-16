import { describe, expect, it } from "vitest";
import { estimatePosition, type TimedStop } from "../src/estimator/estimate.js";
import { RailNetwork } from "../src/estimator/rail-network.js";

const T0 = Date.UTC(2026, 9, 16, 12, 0);
const min = (m: number) => T0 + m * 60_000;

const stops: TimedStop[] = [
  { name: "A", lon: 10, lat: 45, departure: min(0) },
  { name: "B", lon: 10, lat: 46, arrival: min(60), departure: min(62) },
  { name: "C", lon: 11, lat: 46, arrival: min(120) },
];

describe("estimatePosition", () => {
  it("restituisce null prima della partenza e dopo l'arrivo", () => {
    expect(estimatePosition(stops, min(-1))).toBeNull();
    expect(estimatePosition(stops, min(121))).toBeNull();
  });

  it("interpola a meta' tratta con rotta e velocita'", () => {
    const e = estimatePosition(stops, min(30))!;
    expect(e.lat).toBeCloseTo(45.5, 5);
    expect(e.lon).toBeCloseTo(10, 5);
    expect(e.bearing).toBeCloseTo(0, 0);
    // 111 km in un'ora
    expect(e.speedKmh).toBeGreaterThan(105);
    expect(e.speedKmh).toBeLessThan(115);
    expect(e.nextIndex).toBe(1);
  });

  it("riconosce la sosta in stazione", () => {
    const e = estimatePosition(stops, min(61))!;
    expect(e.atStation).toBe(true);
    expect(e.speedKmh).toBe(0);
    expect([e.lon, e.lat]).toEqual([10, 46]);
  });

  it("salta le fermate senza coordinate", () => {
    const withGap: TimedStop[] = [stops[0]!, { name: "X", arrival: min(30), departure: min(31) }, stops[1]!];
    const e = estimatePosition(withGap, min(30))!;
    expect(e.lat).toBeCloseTo(45.5, 1);
  });

  it("segue la geometria dei binari quando disponibile", () => {
    // Percorso a L: A -> (10.5, 45) -> B'
    const net = RailNetwork.fromGeoJson({
      features: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [10, 45],
              [10.5, 45],
              [10.5, 45.5],
            ],
          },
        },
      ],
    });
    const route = net.route([10, 45], [10.5, 45.5])!;
    expect(route.length).toBeGreaterThanOrEqual(3);
    const e = estimatePosition(
      [
        { name: "A", lon: 10, lat: 45, departure: min(0) },
        { name: "B", lon: 10.5, lat: 45.5, arrival: min(60) },
      ],
      min(20),
      net,
    )!;
    // Nel primo terzo il treno e' sul ramo orizzontale (lat costante, rotta verso est)
    expect(e.lat).toBeCloseTo(45, 3);
    expect(e.bearing).toBeGreaterThan(80);
  });
});
