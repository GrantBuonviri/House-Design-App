import { describe, expect, it } from "vitest";
import type { Location } from "@/lib/model/schema";
import { buildCodeSet, codeEntry, codeNum, codeSet, codeSetKey, codeText, setCodeLocation, withCodeLocation, zoneRow } from "@/lib/codes/data";
import { CITIES, cityById, placeFromCity } from "@/lib/location/cities";
import { CITY_OVERLAYS, STATE_OVERLAYS } from "@/lib/codes/data/local";
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
    // The 2021 IECC alone, without the states' own editions and changes.
    const plain = (id: string) => buildCodeSet(place(id), {}).values;
    expect(plain("atlanta-ga")["energy.ceilingR"].value).toBe(49);
    expect(plain("duluth-mn")["energy.ceilingR"].value).toBe(60);
    expect(plain("duluth-mn")["energy.ceilingR"].layer).toBe("zone");
    expect(plain("miami-fl")["energy.airLeakageACH50"].value).toBe(5);
    expect(plain("duluth-mn")["energy.airLeakageACH50"].value).toBe(3);
    // A 2021 IECC state with no changes of its own keeps the zone numbers.
    expect(withCodeLocation(place("richmond-va"), () => codeEntry("energy.ceilingR"))).toMatchObject({ value: 60, layer: "zone" });
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
    expect(Object.values(buildCodeSet(place("denver-co"), {}).values).filter((e) => e.layer === "state" || e.layer === "city")).toEqual([]);
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
    // Richmond follows the 2021 IRC footing tables (Idaho has its own, the same at any snow load).
    const deep = editPlace(place("richmond-va"), "groundSnowPsf", 50);
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

describe("state and city codes", () => {
  type Snap = Record<string, { value: unknown }>;
  const snap = snapshot.values as Snap;
  // Where Boise's numbers now differ from the old 2018 Boise file, and why.
  const CHANGED: Record<string, string> = {
    // Idaho replaced its 5 ACH50 / test-20%-of-homes rule with a choice of a visual check or a blower door test at the 2018 IECC's 3 ACH50 (IDAPA 24.39.30.600, 7-1-24).
    "energy.airLeakageACH50": "3",
    // The place card's winter design temperature (part 1) is 10°F; the old file had 11°F.
    "design.manualJWinter": "10",
    // Same rule, worded from the IRC: the 2015 UPC wording couldn't be checked against a web copy.
    "plumbing.waterHeaterTPRDischarge": "text",
  };
  // Same numbers, new shape: footings by snow column, bracing by wind band, cantilevers with the 2021 table's extra row.
  const SHAPE: Record<string, (v: Record<string, unknown>) => unknown> = {
    "struct.footingsLightFrame": (v) => v["20"],
    "struct.bracingWind": (v) => v["115"],
    "struct.cantilevers": (v) => Object.fromEntries(Object.entries(v).filter(([k]) => k in (snap["struct.cantilevers"].value as object))),
  };

  it("gives a Boise project the numbers it had before, apart from what Idaho changed since", () => {
    const now = codeSet().values;
    expect(codeSet().location.cityId).toBe("boise-id");
    const differ: string[] = [];
    for (const [k, e] of Object.entries(snap)) {
      if (k in CHANGED) continue;
      const v = now[k]?.value;
      const shaped = SHAPE[k] ? SHAPE[k](v as Record<string, unknown>) : v;
      if (JSON.stringify(shaped) !== JSON.stringify(e.value)) differ.push(k);
    }
    expect(differ).toEqual([]);
    expect(now["energy.airLeakageACH50"].value).toBe(3);
    // The Idaho and Boise changes are marked as theirs.
    expect(now["energy.ceilingR"]).toMatchObject({ value: 38, layer: "state", code: "IECC 2018" });
    expect(now["garage.gypsumGarageSide"]).toMatchObject({ value: 0.625, layer: "state" });
    expect(now["elec.afciLocations"].value).toEqual(["bedrooms only (one- and two-family dwellings)"]);
    expect(now["smoke.garageHeatAlarm"]).toMatchObject({ value: true, layer: "city" });
    expect(now["plumbing.wsfu.bathtub"]).toMatchObject({ value: 2, layer: "state" });
    expect(codeSet().local).toMatchObject({ jurisdiction: "City of Boise, Ada County, Idaho", zoningCode: expect.stringMatching(/Title 11/) });
    expect(codeSet().editions.map((e) => e.label)).toEqual([
      "Residential: 2018 International Residential Code (IRC)",
      "Energy: 2018 International Energy Conservation Code (IECC)",
      "Electrical: 2023 National Electrical Code (NEC)",
      "Plumbing: Idaho State Plumbing Code 2017 (IDAPA 24.39.20)",
      "Mechanical and fuel gas: 2018 IRC chapters 12 to 24",
    ]);
  });

  it("has no Boise heat alarm in Denver", () => {
    withCodeLocation(place("denver-co"), () => {
      expect(codeEntry("smoke.garageHeatAlarm").value).toBe(false);
      expect(codeSet().local.jurisdiction).toMatch(/Denver/);
    });
  });

  it("uses the UPC's plumbing numbers in a UPC state, and the IRC's elsewhere", () => {
    // Seattle: Washington adopted the 2021 UPC.
    withCodeLocation(place("seattle-wa"), () => {
      expect(codeNum("plumbing.wcFrontClearance")).toBe(24);
      expect(codeNum("plumbing.showerMinArea")).toBe(1024);
      expect(codeNum("plumbing.wsfu.bathtub")).toBe(4);
      expect(codeEntry("plumbing.wcFrontClearance")).toMatchObject({ code: "UPC 2021" });
    });
    withCodeLocation(place("richmond-va"), () => {
      expect(codeNum("plumbing.wcFrontClearance")).toBe(21);
      expect(codeNum("plumbing.showerMinArea")).toBe(900);
    });
  });

  it("uses the energy edition a state adopted", () => {
    // Omaha: Nebraska is on the 2018 IECC (zone 5 ceiling R-49, not 2021's R-60).
    withCodeLocation(place("omaha-ne"), () => {
      expect(codeEntry("energy.ceilingR")).toMatchObject({ value: 49, code: "IECC 2018", layer: "state" });
      expect(codeSet().editions[1].label).toBe("Energy: 2018 International Energy Conservation Code (IECC)");
    });
    // A state's own number for one climate zone only: Minnesota's table for Duluth (zone 7).
    withCodeLocation(place("duluth-mn"), () => expect(codeEntry("energy.ceilingR").layer).toBe("state"));
  });

  it("keeps a local roof snow load only as a minimum, and a typed number over any local change", () => {
    expect(codeNum("design.roofSnowLoadMin")).toBe(25);
    expect(withCodeLocation(editPlace(DEFAULT_PLACE, "groundSnowPsf", 60), () => codeNum("design.roofSnowLoadMin"))).toBe(45);
  });

  it("has only base keys in every state and city file, each with a source, and never uses an unconfirmed one", () => {
    const keys = new Set(Object.keys(buildCodeSet(DEFAULT_PLACE, {}).values));
    for (const [id, o] of [...Object.entries(STATE_OVERLAYS), ...Object.entries(CITY_OVERLAYS)]) {
      for (const [key, e] of Object.entries(o.values)) {
        expect(keys.has(key.split("@")[0]), `${id}: ${key}`).toBe(true);
        if (!e.unverified) expect(e.source, `${id}: ${key}`).toMatch(/^https?:\/\//);
      }
    }
    for (const c of CITIES) {
      const set = buildCodeSet(placeFromCity(c));
      for (const [k, e] of Object.entries(set.values)) if (e.layer === "state" || e.layer === "city") expect(e.unverified, `${c.id}: ${k}`).toBeFalsy();
      expect(set.editions).toHaveLength(5);
    }
    // Every listed city's state has a file.
    for (const c of CITIES) expect(STATE_OVERLAYS[c.state.toLowerCase()], c.state).toBeDefined();
  });

  it("says what applies for a place off the list", () => {
    const elsewhere = { ...DEFAULT_PLACE, cityId: "elsewhere-id", name: "Elsewhere in Idaho" };
    const set = buildCodeSet(elsewhere);
    expect(set.values["energy.ceilingR"].value).toBe(38);
    expect(set.values["smoke.garageHeatAlarm"].value).toBe(false);
    expect(set.local.elsewhere).toMatch(/Idaho/);
  });
});
