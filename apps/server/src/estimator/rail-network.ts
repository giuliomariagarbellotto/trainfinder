import fs from "node:fs";
import { haversine, type LonLat } from "@trainfinder/shared";
import type { RailRouter } from "./estimate.js";

interface GeoJsonLike {
  features: { geometry: { type: string; coordinates: unknown } | null }[];
}

/** Cella della griglia di snapping, circa 1 km. */
const CELL = 0.01;
const SNAP_MAX_M = 3_000;
/** Oltre questa lunghezza rispetto alla linea retta il percorso trovato e' considerato errato. */
const MAX_DETOUR = 2.5;

/**
 * Grafo dei binari costruito da un GeoJSON di LineString (es. estratto OSM railway=rail).
 * Trova il percorso piu' breve tra due stazioni con Dijkstra e mette in cache i risultati.
 */
export class RailNetwork implements RailRouter {
  private coords: LonLat[] = [];
  private index = new Map<string, number>();
  private adj: { to: number; w: number }[][] = [];
  private grid = new Map<string, number[]>();
  private cache = new Map<string, LonLat[] | null>();

  static fromFile(file: string): RailNetwork {
    return RailNetwork.fromGeoJson(JSON.parse(fs.readFileSync(file, "utf8")) as GeoJsonLike);
  }

  static fromGeoJson(geo: GeoJsonLike): RailNetwork {
    const net = new RailNetwork();
    for (const f of geo.features) {
      const g = f.geometry;
      if (!g) continue;
      const lines =
        g.type === "LineString" ? [g.coordinates as LonLat[]] : g.type === "MultiLineString" ? (g.coordinates as LonLat[][]) : [];
      for (const line of lines) net.addLine(line);
    }
    return net;
  }

  get nodeCount(): number {
    return this.coords.length;
  }

  private nodeId(p: LonLat): number {
    // Arrotondamento a ~1 m per unire i vertici condivisi tra way OSM.
    const key = `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
    let id = this.index.get(key);
    if (id === undefined) {
      id = this.coords.length;
      this.coords.push([p[0], p[1]]);
      this.adj.push([]);
      this.index.set(key, id);
      const cell = this.cellKey(p);
      const bucket = this.grid.get(cell);
      if (bucket) bucket.push(id);
      else this.grid.set(cell, [id]);
    }
    return id;
  }

  private cellKey(p: LonLat, dx = 0, dy = 0): string {
    return `${Math.floor(p[0] / CELL) + dx},${Math.floor(p[1] / CELL) + dy}`;
  }

  addLine(line: LonLat[]): void {
    for (let i = 1; i < line.length; i++) {
      const a = this.nodeId(line[i - 1]!);
      const b = this.nodeId(line[i]!);
      if (a === b) continue;
      const w = haversine(this.coords[a]!, this.coords[b]!);
      this.adj[a]!.push({ to: b, w });
      this.adj[b]!.push({ to: a, w });
    }
  }

  nearest(p: LonLat): number | undefined {
    let best: number | undefined;
    let bestD = SNAP_MAX_M;
    for (let r = 0; r <= 3 && best === undefined; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const id of this.grid.get(this.cellKey(p, dx, dy)) ?? []) {
            const d = haversine(p, this.coords[id]!);
            if (d < bestD) {
              bestD = d;
              best = id;
            }
          }
        }
      }
    }
    return best;
  }

  route(a: LonLat, b: LonLat): LonLat[] | null {
    const key = `${a[0]},${a[1]}>${b[0]},${b[1]}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const result = this.computeRoute(a, b);
    if (this.cache.size > 50_000) this.cache.clear();
    this.cache.set(key, result);
    return result;
  }

  private computeRoute(a: LonLat, b: LonLat): LonLat[] | null {
    const s = this.nearest(a);
    const t = this.nearest(b);
    if (s === undefined || t === undefined) return null;
    if (s === t) return [a, b];
    const direct = haversine(a, b);
    const limit = Math.max(direct * MAX_DETOUR, 5_000);

    const dist = new Map<number, number>([[s, 0]]);
    const prev = new Map<number, number>();
    const heap = new MinHeap();
    heap.push(s, 0);
    while (heap.size) {
      const [u, d] = heap.pop()!;
      if (u === t) break;
      if (d > (dist.get(u) ?? Infinity) || d > limit) continue;
      for (const { to, w } of this.adj[u]!) {
        const nd = d + w;
        if (nd < (dist.get(to) ?? Infinity)) {
          dist.set(to, nd);
          prev.set(to, u);
          heap.push(to, nd);
        }
      }
    }
    if (!dist.has(t) || dist.get(t)! > limit) return null;
    const path: LonLat[] = [];
    for (let cur: number | undefined = t; cur !== undefined; cur = prev.get(cur)) path.push(this.coords[cur]!);
    path.reverse();
    return [a, ...path, b];
  }
}

class MinHeap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(node: number, prio: number) {
    const a = this.items;
    a.push([node, prio]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![1] <= a[i]![1]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![1] < a[m]![1]) m = l;
        if (r < a.length && a[r]![1] < a[m]![1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}
