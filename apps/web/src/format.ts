import type { TrainPosition } from "@trainfinder/shared";

export const COUNTRY_NAMES: Record<string, string> = {
  FI: "Finlandia",
  NO: "Norvegia",
  IE: "Irlanda",
  IT: "Italia",
  GB: "Regno Unito",
};

export function trainLabel(t: Pick<TrainPosition, "category" | "number">): string {
  return t.category && !t.number.startsWith(t.category) ? `${t.category} ${t.number}` : t.number;
}

export function delayText(delay?: number): string {
  if (delay == null) return "n.d.";
  if (delay === 0) return "In orario";
  if (delay < 0) return `${-delay} min in anticipo`;
  return `+${delay} min`;
}

export type DelayClass = "unknown" | "ontime" | "minor" | "late" | "verylate";

export function delayClass(delay?: number): DelayClass {
  if (delay == null) return "unknown";
  if (delay <= 1) return "ontime";
  if (delay <= 5) return "minor";
  if (delay <= 15) return "late";
  return "verylate";
}

export function timeText(ms?: number): string {
  if (ms == null) return "";
  return new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

export function agoText(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s fa`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min fa`;
  return `${Math.round(m / 60)} h fa`;
}
