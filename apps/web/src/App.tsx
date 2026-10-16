import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SourceHealth, TrainDetail } from "@trainfinder/shared";
import { TrainFeed } from "./feed";
import { TrainMap } from "./components/TrainMap";
import { TrainPanel } from "./components/TrainPanel";
import { SearchBox } from "./components/SearchBox";
import { SourcesPanel } from "./components/SourcesPanel";
import { COUNTRY_NAMES } from "./format";

const DETAIL_REFRESH_MS = 10_000;

export function App() {
  const feed = useMemo(() => new TrainFeed(), []);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<TrainDetail>();
  const [sources, setSources] = useState<SourceHealth[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [showRailways, setShowRailways] = useState(false);
  const [hiddenCountries, setHiddenCountries] = useState<Set<string>>(new Set());
  const [onlyReported, setOnlyReported] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; key: number }>();

  useEffect(() => {
    feed.connect();
    return () => feed.disconnect();
  }, [feed]);

  // Contatore treni visibili e stato connessione, aggiornati a ogni messaggio.
  const status = useSyncExternalStore(
    useCallback((cb) => feed.subscribe(cb), [feed]),
    () => `${feed.state}|${feed.trains.size}`,
  );
  const [connState, visibleCount] = status.split("|") as [string, string];

  useEffect(() => {
    const load = () =>
      fetch("/api/sources")
        .then((r) => r.json() as Promise<SourceHealth[]>)
        .then(setSources)
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(undefined);
      return;
    }
    let cancelled = false;
    const load = () =>
      fetch(`/api/trains/${encodeURIComponent(selectedId)}`)
        .then((r) => (r.ok ? (r.json() as Promise<TrainDetail>) : undefined))
        .then((d) => {
          if (!cancelled) setDetail(d);
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(load, DETAIL_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selectedId]);

  const filter = useCallback(
    (t: { country: string; quality: string }) => !hiddenCountries.has(t.country) && (!onlyReported || t.quality === "reported"),
    [hiddenCountries, onlyReported],
  );

  const onSelect = useCallback((id?: string) => setSelectedId(id), []);

  const countries = useMemo(
    () => [...new Set(sources.filter((s) => s.state !== "disabled").map((s) => s.country))],
    [sources],
  );
  const totalTrains = sources.reduce((n, s) => n + s.trains, 0);

  return (
    <div className="app">
      <TrainMap
        feed={feed}
        selectedId={selectedId}
        detail={detail}
        showRailways={showRailways}
        filter={filter}
        onSelect={onSelect}
        flyTo={flyTo}
      />

      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <path d="M16 3 L26 27 L16 22 L6 27 Z" fill="currentColor" />
          </svg>
          <span>TrainFinder</span>
        </div>
        <SearchBox
          onPick={(t) => {
            setSelectedId(t.id);
            setFlyTo({ lon: t.lon, lat: t.lat, key: Date.now() });
          }}
        />
        <button className="chip" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources}>
          <span className={`dot dot-${connState}`} />
          {totalTrains.toLocaleString("it-IT")} treni
        </button>
      </header>

      <div className="toolbar">
        <label className="toggle">
          <input type="checkbox" checked={showRailways} onChange={(e) => setShowRailways(e.target.checked)} />
          Binari
        </label>
        <label className="toggle">
          <input type="checkbox" checked={onlyReported} onChange={(e) => setOnlyReported(e.target.checked)} />
          Solo posizioni rilevate
        </label>
        {countries.map((c) => (
          <label className="toggle" key={c}>
            <input
              type="checkbox"
              checked={!hiddenCountries.has(c)}
              onChange={(e) => {
                const next = new Set(hiddenCountries);
                if (e.target.checked) next.delete(c);
                else next.add(c);
                setHiddenCountries(next);
              }}
            />
            {COUNTRY_NAMES[c] ?? c}
          </label>
        ))}
      </div>

      {showSources && <SourcesPanel sources={sources} visible={Number(visibleCount)} onClose={() => setShowSources(false)} />}

      {detail && <TrainPanel train={detail} serverNow={() => feed.serverNow()} onClose={() => setSelectedId(undefined)} />}

      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="Legenda">
      <span><i className="sw sw-ontime" />In orario</span>
      <span><i className="sw sw-minor" />+2-5</span>
      <span><i className="sw sw-late" />+6-15</span>
      <span><i className="sw sw-verylate" />&gt;15 min</span>
      <span><i className="sw sw-solid" />Rilevata</span>
      <span><i className="sw sw-outline" />Stimata</span>
    </div>
  );
}
