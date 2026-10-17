import { describe, expect, it } from "vitest";
import { createProject, migrateProject } from "@/lib/model/project";
import { CITIES, cityById, placeFromCity, placeLabel, searchCities } from "@/lib/location/cities";
import { DEFAULT_PLACE, editPlace, locationOf, resetPlaceField } from "@/lib/location/current";
import { clockTime } from "@/lib/house3d/sun";
import { sunPosition, WINTER_SOLSTICE } from "@/lib/land/sun";
import { defaultBasics } from "@/lib/plan/basics";
import { describeChange } from "@/lib/store/describe";
import { Location } from "@/lib/model/schema";

const place = (id: string) => placeFromCity(cityById(id)!);

describe("places to build", () => {
  it("covers every state and DC, each with an Elsewhere choice", () => {
    const states = new Set(CITIES.filter((c) => !c.elsewhere).map((c) => c.state));
    expect(states.size).toBe(51);
    expect(CITIES.filter((c) => c.elsewhere)).toHaveLength(51);
    for (const c of CITIES) expect(() => Location.parse(placeFromCity(c))).not.toThrow();
  });

  it("finds places by city or state", () => {
    expect(searchCities("boise")[0].id).toBe("boise-id");
    expect(searchCities("Denver")[0].id).toBe("denver-co");
    const texas = searchCities("texas", 50);
    expect(texas.length).toBeGreaterThan(2);
    expect(texas.every((c) => c.state === "TX")).toBe(true);
    expect(texas.some((c) => c.id === "elsewhere-tx")).toBe(true);
    expect(placeLabel(cityById("elsewhere-tx")!)).toBe("Elsewhere in Texas");
    expect(searchCities("")).toEqual([]);
  });

  it("sets older projects to Boise and leaves new ones unpicked", () => {
    const older = { ...createProject("Old"), schemaVersion: 29 } as Record<string, unknown>;
    delete older.location;
    expect(migrateProject(older).location).toEqual(place("boise-id"));
    const fresh = createProject("New");
    expect(fresh.location).toBeNull();
    expect(locationOf(fresh)).toEqual(DEFAULT_PLACE);
    expect(DEFAULT_PLACE.cityId).toBe("boise-id");
  });

  it("remembers edited numbers and puts them back", () => {
    const denver = place("denver-co");
    const edited = editPlace(denver, "frostDepthIn", 40);
    expect(edited.frostDepthIn).toBe(40);
    expect(edited.edited).toEqual(["frostDepthIn"]);
    expect(resetPlaceField(edited, "frostDepthIn")).toEqual(denver);
  });

  it("labels undo steps", () => {
    const a = createProject("House");
    const b = { ...a, location: place("denver-co") };
    expect(describeChange(a, b)).toBe("set the place to Denver, CO");
    expect(describeChange(b, { ...b, location: editPlace(b.location, "groundSnowPsf", 40) })).toBe("change the ground snow");
  });

  it("starts outside walls at 2x6 in cold zones and 2x4 in warm ones", () => {
    expect(defaultBasics("5B").exteriorWall).toBe("2x6");
    expect(defaultBasics("7").exteriorWall).toBe("2x6");
    expect(defaultBasics("2A").exteriorWall).toBe("2x4");
    expect(defaultBasics().exteriorWall).toBe("2x6");
  });
});

describe("sun and clock follow the place", () => {
  it("keeps Boise's clock exactly as before (45 minutes ahead of the sun, plus daylight saving)", () => {
    const boise = place("boise-id");
    for (let h = 4; h <= 21; h += 0.25) {
      for (const dst of [false, true]) {
        const before = solarToClockBefore(h, dst);
        expect(clockTime(h, dst, boise)).toBe(before);
      }
    }
  });

  it("puts the winter noon sun higher in Miami than in Boise", () => {
    const miami = place("miami-fl");
    const boise = place("boise-id");
    expect(sunPosition(WINTER_SOLSTICE, 12, miami.latitudeDeg).altitudeDeg).toBeGreaterThan(sunPosition(WINTER_SOLSTICE, 12, boise.latitudeDeg).altitudeDeg + 15);
  });

  it("has no daylight saving in Phoenix", () => {
    const phoenix = place("phoenix-az");
    expect(phoenix.daylightSaving).toBe(false);
    expect(clockTime(12, true, phoenix)).toBe(clockTime(12, false, phoenix));
    const boise = place("boise-id");
    expect(clockTime(12, true, boise)).not.toBe(clockTime(12, false, boise));
  });
});

/** The clock before places existed: Boise solar time + 0.75 h, + 1 h in daylight saving time. */
function solarToClockBefore(solarHour: number, daylightSaving: boolean): string {
  const h = solarHour + 0.75 + (daylightSaving ? 1 : 0);
  const mins = Math.round((h * 60) / 15) * 15;
  const hh = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
}
