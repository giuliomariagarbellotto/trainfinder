import { bearing, haversine, type LonLat } from "@trainfinder/shared";

interface Fix {
  p: LonLat;
  t: number;
  bearing?: number;
  speedKmh?: number;
}

/**
 * Ricava rotta e velocita' da fix successivi, per le fonti che danno solo la posizione.
 * Sotto MIN_MOVE_M lo spostamento e' rumore e si mantiene la rotta precedente.
 */
export class MotionTracker {
  private fixes = new Map<string, Fix>();
  private static readonly MIN_MOVE_M = 25;

  update(id: string, p: LonLat, t: number): { bearing?: number; speedKmh?: number } {
    const prev = this.fixes.get(id);
    if (!prev) {
      this.fixes.set(id, { p, t });
      return {};
    }
    if (t <= prev.t) return { bearing: prev.bearing, speedKmh: prev.speedKmh };
    const dist = haversine(prev.p, p);
    if (dist < MotionTracker.MIN_MOVE_M) {
      // Fermo (o quasi): velocita' a zero solo se e' passato abbastanza tempo da esserne certi.
      const speedKmh = t - prev.t > 60_000 ? 0 : prev.speedKmh;
      this.fixes.set(id, { ...prev, t, speedKmh });
      return { bearing: prev.bearing, speedKmh };
    }
    const next: Fix = {
      p,
      t,
      bearing: bearing(prev.p, p),
      speedKmh: Math.round((dist / ((t - prev.t) / 1000)) * 3.6),
    };
    this.fixes.set(id, next);
    return { bearing: next.bearing, speedKmh: next.speedKmh };
  }

  forget(id: string): void {
    this.fixes.delete(id);
  }

  prune(keep: Set<string>): void {
    for (const id of this.fixes.keys()) if (!keep.has(id)) this.fixes.delete(id);
  }
}
