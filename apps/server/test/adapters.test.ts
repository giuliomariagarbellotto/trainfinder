import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFinnishMeta, finnishTrain, type DtLocation, type DtRunningTrain, type DtStation } from "../src/adapters/finland.js";
import { enturTrain, enturTrainNumber, type EnturVehicle } from "../src/adapters/norway.js";
import { parseIrishMessage, parseIrishXml } from "../src/adapters/ireland.js";
import { italianTrain, isFinished, normalizeName, viaggiaTrenoDate, type VtStation, type VtTrainStatus } from "../src/adapters/italy.js";
import { parseBerthCsv, tdEvents } from "../src/adapters/uk-td.js";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("Finlandia (Digitraffic)", () => {
  const train = JSON.parse(fixture("digitraffic-running-train.json")) as DtRunningTrain;

  it("costruisce i metadati del treno", () => {
    const stations = new Map<string, DtStation>();
    const meta = buildFinnishMeta(train, stations);
    expect(meta.category).toBe("IC");
    expect(meta.operator).toBe("VR");
    expect(meta.origin).toBeTruthy();
    expect(meta.destination).toBeTruthy();
    expect(meta.stops.length).toBeGreaterThan(1);
    // Le fermate sono uniche e in ordine
    const codes = meta.stops.map((s) => s.code);
    for (let i = 1; i < codes.length; i++) expect(codes[i]).not.toBe(codes[i - 1]);
  });

  it("converte le posizioni", () => {
    const [loc] = JSON.parse(fixture("digitraffic-locations.json")) as DtLocation[];
    const t = finnishTrain(loc!, undefined, { bearing: 90 });
    expect(t.id).toBe(`fi:${loc!.departureDate}:${loc!.trainNumber}`);
    expect(t.lon).toBe(loc!.location.coordinates[0]);
    expect(t.speedKmh).toBe(loc!.speed);
    expect(t.quality).toBe("reported");
  });
});

describe("Norvegia (Entur)", () => {
  const vehicles = JSON.parse(fixture("entur-vehicles.json")) as EnturVehicle[];

  it("estrae il numero treno", () => {
    expect(enturTrainNumber({ vehicleId: "325-2026-10-16" } as EnturVehicle)).toBe("325");
    expect(enturTrainNumber({ vehicleId: "71-06" } as EnturVehicle)).toBe("71-06");
  });

  it("converte i veicoli", () => {
    for (const v of vehicles) {
      const t = enturTrain(v, {})!;
      expect(t.country).toBe("NO");
      expect(t.lat).toBe(v.location!.latitude);
      expect(t.updatedAt).toBe(Math.round(v.lastUpdatedEpochSecond * 1000));
      if (v.delay != null) expect(t.delayMin).toBe(Math.round(v.delay / 60));
    }
    expect(enturTrain(vehicles[0]!, {})!.operator).toBe("Vy");
  });
});

describe("Irlanda (Irish Rail)", () => {
  it("legge l'XML", () => {
    const trains = parseIrishXml(fixture("irishrail-current-trains.xml"));
    expect(trains.length).toBe(5);
    expect(trains.filter((t) => t.TrainStatus === "R" && t.TrainLatitude !== 0).length).toBe(3);
    expect(trains[0]!.TrainCode).toBe("A306");
  });

  it("interpreta i messaggi pubblici", () => {
    expect(parseIrishMessage("A306\\n13:25 - Mallow to Tralee (1 mins late)\\nDeparted Mallow next stop Banteer")).toEqual({
      origin: "Mallow",
      destination: "Tralee",
      delayMin: 1,
      nextStop: "Banteer",
    });
    expect(parseIrishMessage("A806\\n14:45 - Dublin Heuston to Westport (-15 mins late)\\nArrived X next stop Portarlington").delayMin).toBe(-15);
    expect(parseIrishMessage("P521\\nCobh to Cork\\nExpected Departure 14:30")).toEqual({ origin: "Cobh", destination: "Cork" });
  });
});

describe("Italia (ViaggiaTreno)", () => {
  const status = JSON.parse(fixture("viaggiatreno-andamento.json")) as VtTrainStatus;
  const stations = new Map<string, VtStation>([
    ["S01700", { codiceStazione: "S01700", codReg: 1, lat: 45.4861, lon: 9.2047 }],
    ["S05043", { codiceStazione: "S05043", codReg: 5, lat: 44.5058, lon: 11.3428 }],
    ["S08409", { codiceStazione: "S08409", codReg: 5, lat: 41.9009, lon: 12.5019 }],
  ]);

  it("formatta le date come vuole ViaggiaTreno", () => {
    expect(viaggiaTrenoDate(new Date("2026-10-16T12:00:00Z"))).toBe("Fri Oct 16 2026 14:00:00 GMT+0200");
    expect(viaggiaTrenoDate(new Date("2026-01-10T08:05:09Z"))).toBe("Sat Jan 10 2026 09:05:09 GMT+0100");
  });

  it("normalizza i nomi stazione", () => {
    expect(normalizeName("Firenze S. M. N.")).toBe(normalizeName("FIRENZE SANTA MARIA NOVELLA"));
    expect(normalizeName("Venezia S. Lucia")).toBe(normalizeName("VENEZIA SANTA LUCIA"));
  });

  it("stima la posizione tra Milano e Bologna", () => {
    // Partenza reale 1792152300000, arrivo previsto a Bologna = teorico + 5 min = 1792155900000
    const mid = (1792152300000 + 1792155900000) / 2;
    const t = italianTrain("S01700/9531/1792105200000", status, stations, mid)!;
    expect(t.quality).toBe("estimated");
    expect(t.category).toBe("FR");
    expect(t.origin).toBe("Milano Centrale");
    expect(t.nextStop).toBe("Bologna Centrale");
    expect(t.lat).toBeCloseTo((45.4861 + 44.5058) / 2, 3);
    expect(t.speedKmh).toBeGreaterThan(150);
  });

  it("ignora treni soppressi o conclusi", () => {
    expect(italianTrain("k", { ...status, provvedimento: 1 }, stations, 1792153000000)).toBeUndefined();
    expect(isFinished(status, 1792163400000 + 40 * 60_000)).toBe(true);
    expect(isFinished(status, 1792160000000)).toBe(false);
  });
});

describe("Regno Unito (Train Describer)", () => {
  const berths = parseBerthCsv("area_id,berth,lat,lon\nSK,3649,51.5,-0.1\nSK,3651,51.51,-0.1\n");

  it("legge il CSV dei berth", () => {
    expect(berths.get("SK:3649")).toEqual([-0.1, 51.5]);
  });

  it("trasforma i messaggi TD in eventi", () => {
    const events = tdEvents(
      [
        { CA_MSG: { time: "1792157000000", area_id: "SK", msg_type: "CA", from: "3647", to: "3649", descr: "1F42" } },
        { CC_MSG: { time: "1792157000000", area_id: "SK", msg_type: "CC", to: "9999", descr: "2B10" } },
        { CB_MSG: { time: "1792157000000", area_id: "SK", msg_type: "CB", from: "3651", descr: "2C33" } },
        { CA_MSG: { time: "1792157000000", area_id: "SK", msg_type: "CA", from: "1", to: "3651", descr: "****" } },
      ],
      berths,
    );
    expect(events).toEqual([
      { kind: "move", id: "gb:SK:1F42", descr: "1F42", area: "SK", time: 1792157000000, position: [-0.1, 51.5] },
      { kind: "cancel", id: "gb:SK:2C33", descr: "2C33", area: "SK", time: 1792157000000 },
    ]);
  });
});
