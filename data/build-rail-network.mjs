#!/usr/bin/env node
/**
 * Scarica da OpenStreetMap (Overpass API) le linee ferroviarie di uno o piu' paesi
 * e le salva come GeoJSON di LineString, usato dal server per far seguire i binari
 * alle posizioni stimate (variabile RAIL_NETWORK_FILE).
 *
 * Uso: node data/build-rail-network.mjs IT [GB ...] > data/rail-network.geojson
 *
 * Dati (c) OpenStreetMap contributors, licenza ODbL.
 */
const countries = process.argv.slice(2).map((c) => c.toUpperCase());
if (!countries.length) {
  console.error("Uso: node data/build-rail-network.mjs <ISO2> [<ISO2> ...] > data/rail-network.geojson");
  process.exit(1);
}

const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

/** Solo binari principali e secondari in esercizio: niente scali, raccordi o binari di servizio. */
const query = (iso) => `
[out:json][timeout:900];
area["ISO3166-1"="${iso}"][admin_level=2]->.a;
way["railway"="rail"]["usage"~"^(main|branch)$"][!"service"](area.a);
out geom;`;

const features = [];
for (const iso of countries) {
  console.error(`Scarico ${iso} da ${OVERPASS}...`);
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "trainfinder-rail-network" },
    body: new URLSearchParams({ data: query(iso) }),
  });
  if (!res.ok) throw new Error(`Overpass ha risposto ${res.status} per ${iso}`);
  const json = await res.json();
  let n = 0;
  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !el.geometry?.length) continue;
    features.push({
      type: "Feature",
      properties: { id: el.id },
      geometry: {
        type: "LineString",
        // 5 decimali = circa 1 m, sufficiente e riduce molto la dimensione del file
        coordinates: el.geometry.map((p) => [Number(p.lon.toFixed(5)), Number(p.lat.toFixed(5))]),
      },
    });
    n++;
  }
  console.error(`  ${n} tratte`);
}

process.stdout.write(JSON.stringify({ type: "FeatureCollection", features }));
