import { haversine, pointAlong, type LonLat } from "@trainfinder/shared";

export interface TimedStop {
  name: string;
  lon?: number;
  lat?: number;
  /** Orario di arrivo previsto/effettivo (gia' comprensivo di ritardo), ms epoch. */
  arrival?: number;
  /** Orario di partenza previsto/effettivo, ms epoch. */
  departure?: number;
}

export interface Estimate {
  lon: number;
  lat: number;
  bearing?: number;
  speedKmh: number;
  /** Indice della prossima fermata in `stops`. */
  nextIndex: number;
  atStation: boolean;
}

/** Restituisce la geometria tra due punti (es. lungo i binari) oppure null. */
export interface RailRouter {
  route(a: LonLat, b: LonLat): LonLat[] | null;
}

export const straightRouter: RailRouter = { route: (a, b) => [a, b] };

const located = (s: TimedStop): s is TimedStop & { lon: number; lat: number } =>
  Number.isFinite(s.lon) && Number.isFinite(s.lat);

/**
 * Stima la posizione di un treno all'istante `now` dalla sequenza di fermate con orari.
 * Tra due fermate assume velocita' costante lungo la geometria fornita dal router.
 * Restituisce null se il treno non e' ancora partito o e' gia' arrivato a destinazione.
 */
export function estimatePosition(stops: TimedStop[], now: number, router: RailRouter = straightRouter): Estimate | null {
  const pts = stops.map((s, i) => ({ s, i })).filter(({ s }) => located(s));
  if (pts.length < 2) return null;

  const first = pts[0]!.s;
  const last = pts[pts.length - 1]!.s;
  const startTime = first.departure ?? first.arrival;
  const endTime = last.arrival ?? last.departure;
  if (startTime == null || endTime == null || now < startTime || now > endTime) return null;

  for (let k = 0; k < pts.length; k++) {
    const { s, i } = pts[k]!;
    const arr = s.arrival ?? s.departure;
    const dep = s.departure ?? s.arrival;
    // Fermo in stazione.
    if (arr != null && dep != null && now >= arr && now <= dep) {
      return { lon: s.lon!, lat: s.lat!, speedKmh: 0, nextIndex: Math.min(i + 1, stops.length - 1), atStation: true };
    }
    const nextPt = pts[k + 1];
    if (!nextPt) break;
    const n = nextPt.s;
    const segStart = dep;
    const segEnd = n.arrival ?? n.departure;
    if (segStart == null || segEnd == null) continue;
    if (now > segStart && now < segEnd) {
      const a: LonLat = [s.lon!, s.lat!];
      const b: LonLat = [n.lon!, n.lat!];
      const line = router.route(a, b) ?? [a, b];
      const t = (now - segStart) / (segEnd - segStart);
      const { point, bearing } = pointAlong(line, t);
      let length = 0;
      for (let j = 1; j < line.length; j++) length += haversine(line[j - 1]!, line[j]!);
      const speedKmh = Math.round((length / ((segEnd - segStart) / 1000)) * 3.6);
      return { lon: point[0], lat: point[1], bearing, speedKmh, nextIndex: nextPt.i, atStation: false };
    }
  }
  return null;
}
