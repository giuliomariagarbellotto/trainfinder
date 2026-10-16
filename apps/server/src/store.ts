import { inBBox, type BBox, type TrainDetail, type TrainPosition } from "@trainfinder/shared";

const TRAIL_MAX = 40;
/** Un treno senza aggiornamenti da piu' di questo tempo viene tolto dalla mappa. */
const STALE_MS = 15 * 60_000;

/** Toglie i campi pesanti (fermate, scia) per l'invio in massa ai client. */
export function toPosition(t: TrainDetail): TrainPosition {
  const { stops: _stops, trail: _trail, ...pos } = t;
  return pos;
}

export class TrainStore {
  private trains = new Map<string, TrainDetail>();
  private bySource = new Map<string, Set<string>>();
  private changed = new Set<string>();
  private removed = new Set<string>();

  get size(): number {
    return this.trains.size;
  }

  get(id: string): TrainDetail | undefined {
    return this.trains.get(id);
  }

  countBySource(source: string): number {
    return this.bySource.get(source)?.size ?? 0;
  }

  upsert(incoming: TrainDetail[]): void {
    for (const t of incoming) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
      const prev = this.trains.get(t.id);
      const trail = prev?.trail ?? [];
      const last = trail[trail.length - 1];
      if (!last || last[0] !== t.lon || last[1] !== t.lat) {
        trail.push([t.lon, t.lat, t.updatedAt]);
        if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX);
      }
      // Le fermate arrivano solo da alcuni aggiornamenti: se mancano si tengono le precedenti.
      const merged: TrainDetail = { ...t, trail, stops: t.stops ?? prev?.stops };
      this.trains.set(t.id, merged);
      let set = this.bySource.get(t.source);
      if (!set) this.bySource.set(t.source, (set = new Set()));
      set.add(t.id);
      this.changed.add(t.id);
      this.removed.delete(t.id);
    }
  }

  replaceAll(source: string, incoming: TrainDetail[]): void {
    const keep = new Set(incoming.map((t) => t.id));
    const existing = this.bySource.get(source);
    if (existing) this.remove([...existing].filter((id) => !keep.has(id)));
    this.upsert(incoming);
  }

  remove(ids: string[]): void {
    for (const id of ids) {
      const t = this.trains.get(id);
      if (!t) continue;
      this.trains.delete(id);
      this.bySource.get(t.source)?.delete(id);
      this.changed.delete(id);
      this.removed.add(id);
    }
  }

  removeStale(now = Date.now()): number {
    const stale: string[] = [];
    for (const t of this.trains.values()) if (now - t.updatedAt > STALE_MS) stale.push(t.id);
    this.remove(stale);
    return stale.length;
  }

  query(bbox?: BBox): TrainPosition[] {
    const out: TrainPosition[] = [];
    for (const t of this.trains.values()) {
      if (!bbox || inBBox(t.lon, t.lat, bbox)) out.push(toPosition(t));
    }
    return out;
  }

  search(q: string, limit = 20): TrainPosition[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: TrainPosition[] = [];
    for (const t of this.trains.values()) {
      const hay = [t.number, t.category && `${t.category} ${t.number}`, t.origin, t.destination, t.operator]
        .filter(Boolean)
        .join(" | ")
        .toLowerCase();
      if (hay.includes(needle)) out.push(toPosition(t));
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Restituisce e azzera le modifiche accumulate dall'ultima chiamata. */
  drainChanges(): { changed: TrainDetail[]; removed: string[] } {
    const changed = [...this.changed].map((id) => this.trains.get(id)).filter((t): t is TrainDetail => !!t);
    const removed = [...this.removed];
    this.changed.clear();
    this.removed.clear();
    return { changed, removed };
  }
}
