# Dati di supporto

Questa cartella e' montata nel container come `/app/data`. Il server ci salva anche la cache
(`data/cache/`, per esempio l'anagrafica stazioni italiane).

## Rete ferroviaria (consigliata)

Senza geometria dei binari le posizioni stimate (Italia) si muovono in linea retta tra due
stazioni. Con la rete OSM seguono il tracciato reale:

```bash
node data/build-rail-network.mjs IT > data/rail-network.geojson
# poi in .env
RAIL_NETWORK_FILE=/app/data/rail-network.geojson   # con docker compose
RAIL_NETWORK_FILE=data/rail-network.geojson        # con npm run dev
```

Lo scaricamento usa l'Overpass API pubblica e per l'Italia richiede qualche minuto. Il file
(qualche decina di MB) viene caricato in memoria all'avvio.

## Regno Unito: corrispondenza berth -> coordinate

Il feed Train Describer di Network Rail dice in quale "berth" (tratto di segnalamento) si trova
ogni treno, non le coordinate. Serve un CSV con intestazione:

```
area_id,berth,lat,lon
SK,3649,51.5321,-0.1234
```

Come costruirlo:

1. Il file SMART (scaricabile dall'account Network Rail Open Data, sezione "Reference data")
   associa a ogni berth la stazione o il punto di cronometraggio (STANOX) piu' vicino.
2. Le coordinate degli STANOX/TIPLOC si ricavano dal dataset NaPTAN (`RailReferences.csv`) o da
   OpenStreetMap (tag `ref:tiploc`).
3. Unisci le due tabelle e salva il risultato, poi imposta `UK_BERTHS_FILE` nel `.env`.

La precisione dipende da quanto i berth sono vicini ai punti noti: per questo le posizioni UK
sono marcate come stimate.
