import { useEffect, useState } from "react";
import type { TrainDetail } from "@trainfinder/shared";
import { agoText, COUNTRY_NAMES, delayClass, delayText, timeText, trainLabel } from "../format";

interface Props {
  train: TrainDetail;
  serverNow: () => number;
  onClose: () => void;
}

export function TrainPanel({ train, serverNow, onClose }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  const stops = train.stops ?? [];
  return (
    <aside className="panel" aria-label={`Dettagli treno ${trainLabel(train)}`}>
      <div className="panel-head">
        <div>
          <div className="eyebrow">
            {train.operator ?? "Operatore n.d."} · {COUNTRY_NAMES[train.country] ?? train.country}
          </div>
          <h2>{trainLabel(train)}</h2>
          {(train.origin || train.destination) && (
            <div className="route">
              {train.origin ?? "?"} <span aria-hidden="true">→</span> {train.destination ?? "?"}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
          ×
        </button>
      </div>

      <dl className="stats">
        <div>
          <dt>Velocità</dt>
          <dd>{train.speedKmh != null ? `${train.speedKmh} km/h` : "n.d."}</dd>
        </div>
        <div>
          <dt>Ritardo</dt>
          <dd className={`delay-${delayClass(train.delayMin)}`}>{delayText(train.delayMin)}</dd>
        </div>
        <div>
          <dt>Rotta</dt>
          <dd>{train.bearing != null ? `${Math.round(train.bearing)}°` : "n.d."}</dd>
        </div>
        <div>
          <dt>Prossima fermata</dt>
          <dd>{train.nextStop ?? "n.d."}</dd>
        </div>
      </dl>

      <div className={`quality quality-${train.quality}`}>
        {train.quality === "reported"
          ? "Posizione rilevata dalla fonte (GPS o segnalamento)"
          : "Posizione stimata da orario e ritardo"}
        <span className="muted"> · aggiornata {agoText(train.updatedAt, serverNow())}</span>
      </div>

      {stops.length > 0 && (
        <ol className="stops">
          {stops.map((s, i) => {
            const sched = s.scheduledArrival ?? s.scheduledDeparture;
            const actual = s.actualArrival ?? s.actualDeparture;
            return (
              <li key={`${s.code ?? s.name}-${i}`} className={s.passed ? "passed" : ""}>
                <span className="stop-name">{s.name}</span>
                <span className="stop-time">
                  {timeText(sched)}
                  {actual != null && timeText(actual) !== timeText(sched) && <em> {timeText(actual)}</em>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
