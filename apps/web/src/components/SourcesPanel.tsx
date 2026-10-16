import type { SourceHealth } from "@trainfinder/shared";
import { agoText, COUNTRY_NAMES } from "../format";

const STATE_LABEL: Record<SourceHealth["state"], string> = {
  starting: "Avvio",
  ok: "Attiva",
  degraded: "Problemi",
  error: "Errore",
  disabled: "Disattivata",
};

export function SourcesPanel({ sources, visible, onClose }: { sources: SourceHealth[]; visible: number; onClose: () => void }) {
  return (
    <section className="sources" aria-label="Stato delle fonti dati">
      <div className="panel-head">
        <h3>Fonti dati</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
          ×
        </button>
      </div>
      <p className="muted small">{visible.toLocaleString("it-IT")} treni nell'area visibile</p>
      <ul>
        {sources.map((s) => (
          <li key={s.id}>
            <div className="source-row">
              <span className={`badge badge-${s.state}`}>{STATE_LABEL[s.state]}</span>
              <strong>{COUNTRY_NAMES[s.country] ?? s.country}</strong>
              <span className="muted">{s.name}</span>
              <span className="count">{s.trains}</span>
            </div>
            <div className="muted small">
              {s.quality === "reported" ? "Posizioni rilevate" : "Posizioni stimate"}
              {s.lastUpdate ? ` · ${agoText(s.lastUpdate)}` : ""}
            </div>
            {s.message && <div className="small warn">{s.message}</div>}
            <div className="muted tiny">{s.attribution}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
