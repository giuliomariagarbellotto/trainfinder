import { describe, expect, it } from "vitest";
import type { TrainDetail } from "@trainfinder/shared";
import { TrainStore } from "../src/store.js";
import { parseFrames, serializeFrame } from "../src/stomp.js";
import { parseBBox } from "../src/broadcaster.js";

const train = (id: string, lon: number, lat: number, source = "s1"): TrainDetail => ({
  id,
  source,
  country: "XX",
  number: id,
  lat,
  lon,
  quality: "reported",
  updatedAt: Date.now(),
});

describe("TrainStore", () => {
  it("aggiorna, interroga per area e registra la scia", () => {
    const store = new TrainStore();
    store.upsert([train("a", 10, 45), train("b", 20, 50)]);
    store.upsert([train("a", 10.1, 45)]);
    expect(store.size).toBe(2);
    expect(store.query([9, 44, 11, 46]).map((t) => t.id)).toEqual(["a"]);
    expect(store.get("a")!.trail).toHaveLength(2);
    expect("trail" in store.query()[0]!).toBe(false);
  });

  it("replaceAll rimuove i treni scomparsi solo della stessa fonte", () => {
    const store = new TrainStore();
    store.upsert([train("a", 1, 1), train("b", 2, 2), train("c", 3, 3, "s2")]);
    store.drainChanges();
    store.replaceAll("s1", [train("a", 1, 1)]);
    expect(store.get("b")).toBeUndefined();
    expect(store.get("c")).toBeDefined();
    const { removed } = store.drainChanges();
    expect(removed).toEqual(["b"]);
  });

  it("toglie i treni non aggiornati", () => {
    const store = new TrainStore();
    store.upsert([{ ...train("old", 1, 1), updatedAt: Date.now() - 3600_000 }, train("new", 1, 1)]);
    expect(store.removeStale()).toBe(1);
    expect(store.get("new")).toBeDefined();
  });

  it("cerca per numero o destinazione", () => {
    const store = new TrainStore();
    store.upsert([{ ...train("x", 1, 1), number: "9531", destination: "Roma Termini", category: "FR" }]);
    expect(store.search("FR 9531")).toHaveLength(1);
    expect(store.search("roma")).toHaveLength(1);
    expect(store.search("napoli")).toHaveLength(0);
  });
});

describe("STOMP", () => {
  it("analizza frame multipli e frammentati", () => {
    const a = serializeFrame("MESSAGE", { destination: "/topic/TD_ALL_SIG_AREA" }, '[{"x":1}]');
    const b = serializeFrame("CONNECTED", { version: "1.2" });
    const whole = `\n${a}\n${b}`;
    const first = parseFrames(whole.slice(0, 30));
    expect(first.frames).toHaveLength(0);
    const second = parseFrames(first.rest + whole.slice(30));
    expect(second.frames.map((f) => f.command)).toEqual(["MESSAGE", "CONNECTED"]);
    expect(second.frames[0]!.body).toBe('[{"x":1}]');
    expect(second.frames[0]!.headers.destination).toBe("/topic/TD_ALL_SIG_AREA");
  });
});

describe("parseBBox", () => {
  it("rifiuta valori non validi e aggiunge margine", () => {
    expect(parseBBox([0, 0, 1])).toBeUndefined();
    expect(parseBBox([0, 10, 1, 5])).toBeUndefined();
    expect(parseBBox(["a", 0, 1, 1])).toBeUndefined();
    const b = parseBBox([10, 40, 20, 50])!;
    expect(b[0]).toBeLessThan(10);
    expect(b[3]).toBeGreaterThan(50);
  });
});
