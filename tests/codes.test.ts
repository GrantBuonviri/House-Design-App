import { describe, expect, it } from "vitest";
import type { Location } from "@/lib/model/schema";
import { buildCodeSet, codeEntry, codeNum, codeSet, codeSetKey, codeText, setCodeLocation, withCodeLocation, zoneRow } from "@/lib/codes/data";
import { cityById, placeFromCity } from "@/lib/location/cities";
import { DEFAULT_PLACE, editPlace } from "@/lib/location/current";
import { structureOf } from "@/lib/structure";
import { footingSize, pickCantilever } from "@/lib/structure/tables";
import { readiness } from "@/lib/plans/catalog";
import { house, RANCH } from "./samples";
import snapshot from "./fixtures/boise-2018-snapshot.json";

const place = (id: string): Location => placeFromCity(cityById(id)!);
const ranch = () => house(RANCH, 1, 0, 6);

describe("the layered code set", () => {
  it("starts on Boise's numbers and keeps the 2018 snapshot for the local codes part", () => {
    expect(codeSet().location.cityId).toBe("boise-id");
    expect(Object.keys(snapshot.values).length).toBe(251);
    expect((snapshot.values as Record<string, { value: unknown }>)["energy.ceilingR"].value).toBe(38);
  });

  it("takes the design criteria from the place, including the person's own edits", () => {
    const denver = place("denver-co");
    withCodeLocation(denver, () => {
      expect(codeNum("design.groundSnowLoad")).toBe(denver.groundSnowPsf);
      expect(codeNum("design.windSpeed")).toBe(denver.windMph);
      expect(codeText("design.climateZone")).toBe("5B");
      expect(codeEntry("design.groundSnowLoad").layer).toBe("location");
    });
    withCodeLocation(editPlace(denver, "frostDepthIn", 42), () => {
      expect(codeNum("design.frostDepth")).toBe(42);
      expect(codeNum("footing.minDepthFrost")).toBe(42);
      expect(codeEntry("design.frostDepth").note).toMatch(/changed/);
    });
    // Back to Boise afterwards.
    expect(codeNum("design.groundSnowLoad")).toBe(DEFAULT_PLACE.groundSnowPsf);
  });

  it("takes the energy numbers from the climate zone", () => {
    expect(zoneRow("4C")).toBe("4C");
    expect(zoneRow("5B")).toBe("5");
    expect(zoneRow("3A")).toBe("3");
    const z3 = withCodeLocation(place("atlanta-ga"), () => codeNum("energy.ceilingR"));
    const z7 = withCodeLocation(place("duluth-mn"), () => codeNum("energy.ceilingR"));
    expect(z3).toBe(49);
    expect(z7).toBe(60);
    expect(withCodeLocation(place("duluth-mn"), () => codeEntry("energy.ceilingR").layer)).toBe("zone");
    expect(withCodeLocation(place("miami-fl"), () => codeNum("energy.airLeakageACH50"))).toBe(5);
    expect(withCodeLocation(place("duluth-mn"), () => codeNum("energy.airLeakageACH50"))).toBe(3);
  });

  it("puts a state and a city change on top, marked with their layer", () => {
    const boise = DEFAULT_PLACE;
    const set = buildCodeSet(boise, {
      state: { values: { "energy.ceilingR": { value: 38, amendment: "State table" } } },
      city: { jurisdiction: "City of Somewhere", values: { "smoke.garageHeatAlarm": { value: true, amendment: "City rule" } } },
    });
    expect(set.values["energy.ceilingR"]).toMatchObject({ value: 38, layer: "state", amendment: "State table" });
    expect(set.values["smoke.garageHeatAlarm"]).toMatchObject({ value: true, layer: "city" });
    expect(set.meta.jurisdiction).toBe("City of Somewhere");
    // A place with no local files has no state or city changes; Boise keeps its wind basis, unless the person types a wind speed.
    expect(Object.values(buildCodeSet(place("denver-co")).values).filter((e) => e.layer === "state" || e.layer === "city")).toEqual([]);
    expect(buildCodeSet(boise).values["struct.windSpeedBasis"]).toMatchObject({ value: 115, layer: "city" });
    expect(buildCodeSet(editPlace(boise, "windMph", 100)).values["struct.windSpeedBasis"]).toMatchObject({ value: 100, layer: "location" });
  });

  it("changes its cache key with the place, so structure and plans are worked out again", () => {
    const p = ranch();
    const boiseKey = codeSetKey();
    const a = structureOf(p);
    setCodeLocation(place("seattle-wa"));
    expect(codeSetKey()).not.toBe(boiseKey);
    const b = structureOf(p);
    expect(b).not.toBe(a);
    setCodeLocation(null);
    expect(codeSetKey()).toBe(boiseKey);
  });
});

describe("structure for any snow, wind or quake", () => {
  it("picks the footing and cantilever snow columns from the place", () => {
    const deep = editPlace(DEFAULT_PLACE, "groundSnowPsf", 50);
    withCodeLocation(deep, () => {
      expect(codeNum("design.groundSnowLoad")).toBe(50);
      const lowSnow = footingSize(1500, 2, "crawl", 20)!;
      const highSnow = footingSize(1500, 2, "crawl")!;
      expect(highSnow.widthIn).toBeGreaterThan(lowSnow.widthIn);
    });
    // The 50 psf column allows less reach than the 20 psf column.
    expect(pickCantilever(24, 32 * 12, 20)?.allowIn).toBeGreaterThan(pickCantilever(24, 32 * 12, 50)?.allowIn ?? 0);
    expect(pickCantilever(12, 24 * 12, 80)).toBeNull();
  });

  it("asks for an engineer past 140 mph wind, 70 psf snow or seismic category E", () => {
    const p = ranch();
    expect(structureOf(p).limits).toEqual([]);
    const windy = withCodeLocation(editPlace(DEFAULT_PLACE, "windMph", 150), () => structureOf(p));
    expect(windy.limits.map((l) => l.kind)).toEqual(["wind"]);
    expect(windy.engineer[0].text).toMatch(/150 mph/);
    const report = withCodeLocation(editPlace(DEFAULT_PLACE, "windMph", 150), () => readiness(p).report);
    const bracing = report.find((r) => r.rule.id === "wall-bracing")!;
    expect(bracing.results.some((x) => x.status === "manual" && x.text.startsWith("Engineer required") && /150 mph/.test(x.text))).toBe(true);
    expect(withCodeLocation(editPlace(DEFAULT_PLACE, "groundSnowPsf", 90), () => structureOf(p).limits.map((l) => l.kind))).toEqual(["snow"]);
    expect(withCodeLocation(place("los-angeles-ca"), () => structureOf(p).limits.map((l) => l.kind))).toContain("seismic");
  });

  it("needs more bracing in seismic category D1 than in B", () => {
    const p = ranch();
    const total = (sdc: string) =>
      withCodeLocation(editPlace(DEFAULT_PLACE, "seismicCategory", sdc), () => structureOf(p).bracing.reduce((t, b) => t + (b.requiredFt ?? 0), 0));
    const b = total("B");
    const d1 = total("D1");
    expect(d1).toBeGreaterThan(b);
    const lines = withCodeLocation(editPlace(DEFAULT_PLACE, "seismicCategory", "D1"), () => structureOf(p).bracing);
    expect(lines.some((l) => l.governs === "seismic")).toBe(true);
  });
});
