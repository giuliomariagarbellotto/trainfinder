# TrainFinder

Mappa in tempo reale dei treni in stile Flightradar24: posizione, velocità, direzione, ritardo,
origine, destinazione e fermate, per ogni rete che pubblica dati utilizzabili.

Per i treni non esiste un equivalente dell'ADS-B degli aerei. Ogni paese pubblica dati diversi,
quindi l'app distingue sempre tra due tipi di posizione:

- **Rilevata** (freccia piena): coordinate comunicate dalla fonte, da GPS di bordo o dal segnalamento.
- **Stimata** (freccia vuota): calcolata dall'orario e dal ritardo, interpolando tra le stazioni
  lungo i binari, oppure ricavata dagli eventi di circolazione.

Il colore indica il ritardo: verde in orario, giallo fino a 5 minuti, arancione fino a 15, rosso oltre.

## Fonti dati

| Paese | Fonte | Posizione | Accesso |
|---|---|---|---|
| Finlandia | [Digitraffic](https://www.digitraffic.fi/en/railway-traffic/) (Fintraffic) | Rilevata (GPS, velocità), streaming MQTT | Libero, CC BY 4.0 |
| Norvegia | [Entur Vehicle Positions](https://developer.entur.no/) | Rilevata, aggiornamento ogni 15 s | Libero, NLOD |
| Irlanda | [Irish Rail Realtime API](https://api.irishrail.ie/realtime/) | Rilevata (segnalamento) | Libero |
| Italia | ViaggiaTreno (Trenitalia/RFI) | Stimata da orari e ritardi | Interfaccia **non ufficiale** |
| Regno Unito | [Network Rail Open Data](https://publicdatafeeds.networkrail.co.uk/), Train Describer | Stimata dal berth di segnalamento | Account gratuito + file berth |

Per ogni fonte, licenze e attribuzioni sono visibili nell'app (pulsante con il conteggio dei treni).

### Limiti noti

- **Italia**: ViaggiaTreno non ha licenza né garanzie e può cambiare senza preavviso. Il sito
  blocca molti IP di datacenter (risposta 403): se il tuo VPS è bloccato, l'app lo segnala nel
  pannello fonti e riprova ogni 5 minuti. I treni vengono scoperti leggendo i tabelloni partenze
  delle stazioni principali (configurabili con `IT_HUB_STATIONS`), quindi la mappa si popola nei
  primi minuti dopo l'avvio.
- **Regno Unito**: servono le credenziali Network Rail e un CSV che converte i berth in coordinate
  (vedi [data/README.md](data/README.md)). Senza questi l'adapter resta disattivato.
- Le posizioni stimate seguono la linea retta tra due stazioni, a meno che non si generi la rete
  ferroviaria da OpenStreetMap (vedi sotto).

Altre fonti valutate per estensioni future: Svezia (Oxyfi via Trafiklab, GPS a 1 Hz, chiave
dedicata), Australia NSW e treni pendolari USA (GTFS-Realtime con chiave), Amtrak/VIA Rail
(Amtraker, non ufficiale), Taiwan (TDX), Germania, Francia e Svizzera (solo orari in tempo reale,
quindi posizione stimata).

## Architettura

```
packages/shared   tipi comuni (TrainPosition, messaggi WebSocket) e funzioni geografiche
apps/server       Fastify: un adapter per fonte, store in memoria, REST + WebSocket
apps/web          React + MapLibre GL: mappa, ricerca, dettaglio treno, stato fonti
data/             script per la rete ferroviaria OSM e documentazione dei dati di supporto
```

- Ogni adapter (`apps/server/src/adapters/`) converte la propria fonte nel modello comune.
- Lo store tiene l'ultima posizione e una breve scia per ogni treno, e toglie i treni non
  aggiornati da 15 minuti.
- I client WebSocket inviano l'area visibile della mappa e ricevono solo i treni in quell'area,
  con aggiornamenti incrementali ogni 2 secondi.
- In produzione il server pubblica anche il frontend compilato, quindi basta un solo servizio.
- Il browser proietta in avanti la posizione con velocità e rotta (fino a 45 s) per un movimento
  fluido, come fa Flightradar24.

### API

| Endpoint | Descrizione |
|---|---|
| `GET /api/trains?bbox=ovest,sud,est,nord` | Treni nell'area (senza `bbox`: tutti) |
| `GET /api/trains/:id` | Dettaglio con fermate e scia |
| `GET /api/search?q=` | Ricerca per numero, categoria, origine, destinazione |
| `GET /api/sources` | Stato di ogni fonte |
| `WS /ws` | Invia `{"type":"subscribe","bbox":[o,s,e,n]}`, riceve `snapshot` e `update` |

## Sviluppo

Richiede Node.js 22.

```bash
npm install          # compila anche il pacchetto condiviso
npm run dev          # server su :8080, frontend su http://localhost:5173
npm test             # test (Vitest) su dati registrati
npm run typecheck
```

Per limitare le fonti durante lo sviluppo:

```bash
ENABLED_SOURCES=fi-digitraffic,no-entur npm run dev:server
```

## Pubblicazione su Render (consigliata)

Il file `render.yaml` configura tutto: un solo servizio Docker che pubblica mappa, API e WebSocket.

1. Su [render.com](https://render.com) accedi con GitHub.
2. **New** > **Blueprint**, scegli il repository `trainfinder` e il branch da pubblicare.
3. Conferma con **Deploy Blueprint**. La prima build richiede alcuni minuti; al termine l'app è
   su un indirizzo del tipo `https://trainfinder.onrender.com`.

Ogni push sul branch scelto ripubblica l'app in automatico. Con il piano gratuito il servizio si
sospende dopo un periodo senza visite e alla visita successiva impiega circa un minuto a ripartire.

## Pubblicazione su un proprio server con Docker

```bash
git clone https://github.com/giuliomariagarbellotto/trainfinder.git
cd trainfinder
cp .env.example .env      # imposta almeno CLIENT_NAME
docker compose up -d --build
```

L'app risponde sulla porta indicata da `WEB_PORT` (predefinita 80). Per HTTPS conviene mettere
davanti un reverse proxy come [Caddy](https://caddyserver.com/), con `WEB_PORT=127.0.0.1:8088` nel `.env`:

```
treni.example.com {
  reverse_proxy localhost:8088
}
```

### Rete ferroviaria (consigliata per l'Italia)

```bash
node data/build-rail-network.mjs IT > data/rail-network.geojson
echo "RAIL_NETWORK_FILE=/app/data/rail-network.geojson" >> .env
docker compose up -d
```

## Licenze dei dati

I dati restano dei rispettivi fornitori: Fintraffic (CC BY 4.0), Entur (NLOD), Iarnród Éireann,
Network Rail (Open Government Licence), Trenitalia/RFI. Mappa di base © OpenFreeMap, OpenMapTiles,
OpenStreetMap contributors; layer binari © OpenRailwayMap.
