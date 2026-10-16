import { useEffect, useRef, useState } from "react";
import type { TrainPosition } from "@trainfinder/shared";
import { COUNTRY_NAMES, trainLabel } from "../format";

export function SearchBox({ onPick }: { onPick: (t: TrainPosition) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TrainPosition[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json() as Promise<TrainPosition[]>)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="search" ref={box}>
      <input
        type="search"
        placeholder="Cerca treno, stazione o destinazione"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        aria-label="Cerca treno"
      />
      {open && q.trim().length >= 2 && (
        <ul className="results" role="listbox">
          {results.length === 0 && <li className="muted empty">Nessun treno trovato</li>}
          {results.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => {
                  onPick(t);
                  setOpen(false);
                }}
              >
                <strong>{trainLabel(t)}</strong>
                <span className="muted">
                  {[t.origin, t.destination].filter(Boolean).join(" → ") || t.operator} · {COUNTRY_NAMES[t.country] ?? t.country}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
