const R_EARTH_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export type LonLat = [number, number];

/** Distanza ortodromica in metri. */
export function haversine(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rotta iniziale da a verso b, in gradi [0, 360). */
export function bearing(a: LonLat, b: LonLat): number {
  const f1 = toRad(a[1]);
  const f2 = toRad(b[1]);
  const dl = toRad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Interpolazione lineare in coordinate (adeguata per tratte brevi). */
export function lerpLonLat(a: LonLat, b: LonLat, t: number): LonLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function lineLength(line: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversine(line[i - 1]!, line[i]!);
  return total;
}

/**
 * Punto alla frazione t (0..1) della lunghezza di una polilinea,
 * con la rotta del segmento su cui cade.
 */
export function pointAlong(line: LonLat[], t: number): { point: LonLat; bearing: number } {
  if (line.length === 0) throw new Error("linea vuota");
  if (line.length === 1) return { point: line[0]!, bearing: 0 };
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped === 1) {
    const last = line.length - 1;
    return { point: line[last]!, bearing: bearing(line[last - 1]!, line[last]!) };
  }
  const target = lineLength(line) * clamped;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const seg = haversine(a, b);
    if (walked + seg >= target || i === line.length - 1) {
      const local = seg === 0 ? 0 : (target - walked) / seg;
      return { point: lerpLonLat(a, b, Math.min(1, local)), bearing: bearing(a, b) };
    }
    walked += seg;
  }
  const last = line.length - 1;
  return { point: line[last]!, bearing: bearing(line[last - 1]!, line[last]!) };
}

export function inBBox(lon: number, lat: number, bbox: [number, number, number, number]): boolean {
  const [w, s, e, n] = bbox;
  if (lat < s || lat > n) return false;
  // bbox che attraversa l'antimeridiano
  return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
}
