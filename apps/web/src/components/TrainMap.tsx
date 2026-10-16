import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import type { TrainDetail } from "@trainfinder/shared";
import { extrapolate, type TrainFeed } from "../feed";
import { delayClass, trainLabel } from "../format";
import { trainIcons } from "../icons";
import { ACCENT, DELAY_COLORS, MAP_STYLES, prefersDark } from "../theme";

interface Props {
  feed: TrainFeed;
  selectedId?: string;
  detail?: TrainDetail;
  showRailways: boolean;
  filter: (t: { country: string; quality: string }) => boolean;
  onSelect: (id?: string) => void;
  flyTo?: { lon: number; lat: number; key: number };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const FRAME_MS = 100;

export function TrainMap({ feed, selectedId, detail, showRailways, filter, onSelect, flyTo }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap>();
  const ready = useRef(false);
  // Valori letti dal loop di animazione senza ricreare la mappa.
  const live = useRef({ selectedId, filter });
  live.current = { selectedId, filter };

  useEffect(() => {
    const dark = prefersDark();
    const theme = dark ? "dark" : "light";
    const colors = DELAY_COLORS[theme];
    const map = new maplibregl.Map({
      container: container.current!,
      style: MAP_STYLES[theme],
      center: [14, 54],
      zoom: 3.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
    map.addControl(new maplibregl.GeolocateControl({}), "bottom-right");

    const pushBBox = () => {
      const b = map.getBounds();
      feed.setBBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };

    map.on("load", () => {
      for (const [name, img] of Object.entries(trainIcons())) map.addImage(name, img, { sdf: true, pixelRatio: 2 });

      map.addSource("openrailwaymap", {
        type: "raster",
        tiles: ["a", "b", "c"].map((s) => `https://${s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`),
        tileSize: 256,
        maxzoom: 19,
        attribution: '<a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
      });
      map.addLayer({
        id: "openrailwaymap",
        type: "raster",
        source: "openrailwaymap",
        paint: { "raster-opacity": dark ? 0.55 : 0.75 },
        layout: { visibility: "none" },
      });

      map.addSource("trail", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "trail",
        type: "line",
        source: "trail",
        paint: { "line-color": ACCENT[theme], "line-width": 3, "line-opacity": 0.7 },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      map.addSource("stops", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "stops",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": 4,
          "circle-color": ["case", ["get", "passed"], ACCENT[theme], dark ? "#0d1117" : "#ffffff"],
          "circle-stroke-color": ACCENT[theme],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "stops-label",
        type: "symbol",
        source: "stops",
        minzoom: 7,
        layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top" },
        paint: { "text-color": dark ? "#c9d1d9" : "#24292f", "text-halo-color": dark ? "#0d1117" : "#ffffff", "text-halo-width": 1.5 },
      });

      map.addSource("trains", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "train-selected",
        type: "circle",
        source: "trains",
        filter: ["==", ["get", "id"], ""],
        paint: { "circle-radius": 16, "circle-color": ACCENT[theme], "circle-opacity": 0.25, "circle-stroke-color": ACCENT[theme], "circle-stroke-width": 2 },
      });
      map.addLayer({
        id: "trains",
        type: "symbol",
        source: "trains",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-rotate": ["coalesce", ["get", "bearing"], 0],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 8, 0.85, 12, 1.1],
          "text-field": ["step", ["zoom"], "", 9, ["get", "label"]],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "icon-color": ["match", ["get", "delay"], "ontime", colors.ontime, "minor", colors.minor, "late", colors.late, "verylate", colors.verylate, colors.unknown],
          "icon-halo-color": dark ? "#0d1117" : "#ffffff",
          "icon-halo-width": 1.5,
          "text-color": dark ? "#e6edf3" : "#1f2328",
          "text-halo-color": dark ? "#0d1117" : "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      map.on("click", "trains", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelect(id);
      });
      map.on("click", (e) => {
        if (!map.queryRenderedFeatures(e.point, { layers: ["trains"] }).length) onSelect(undefined);
      });
      map.on("mouseenter", "trains", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "trains", () => (map.getCanvas().style.cursor = ""));

      ready.current = true;
      pushBBox();
    });
    map.on("moveend", () => ready.current && pushBBox());

    // Loop di animazione: estrapola le posizioni tra un aggiornamento e l'altro.
    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      if (!ready.current || ts - last < FRAME_MS) return;
      last = ts;
      const now = Date.now();
      const { filter: f, selectedId: sel } = live.current;
      const features: GeoJSON.Feature[] = [];
      for (const t of feed.trains.values()) {
        if (!f(t)) continue;
        const hasDir = t.bearing != null;
        const icon = t.quality === "reported" ? (hasDir ? "train-reported" : "train-dot") : hasDir ? "train-estimated" : "train-dot-estimated";
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: extrapolate(t, now) },
          properties: { id: t.id, icon, bearing: t.bearing, delay: delayClass(t.delayMin), label: trainLabel(t) },
        });
      }
      (map.getSource("trains") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
      map.setFilter("train-selected", ["==", ["get", "id"], sel ?? ""]);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ready.current = false;
      map.remove();
    };
  }, [feed, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    map.setLayoutProperty("openrailwaymap", "visibility", showRailways ? "visible" : "none");
  }, [showRailways]);

  // Scia e fermate del treno selezionato.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const trail = (map.getSource("trail") as GeoJSONSource | undefined);
    const stops = (map.getSource("stops") as GeoJSONSource | undefined);
    if (!detail) {
      trail?.setData(EMPTY);
      stops?.setData(EMPTY);
      return;
    }
    const coords = (detail.trail ?? []).map(([lon, lat]) => [lon, lat]);
    trail?.setData(
      coords.length > 1 ? { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} } : EMPTY,
    );
    stops?.setData({
      type: "FeatureCollection",
      features: (detail.stops ?? [])
        .filter((s) => s.lat != null && s.lon != null)
        .map((s) => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon!, s.lat!] }, properties: { name: s.name, passed: s.passed } })),
    });
  }, [detail]);

  useEffect(() => {
    if (!flyTo || !mapRef.current) return;
    mapRef.current.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: Math.max(mapRef.current.getZoom(), 10) });
  }, [flyTo]);

  return <div ref={container} className="map" />;
}
