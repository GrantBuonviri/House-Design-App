import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@/lib/model/schema";
import { codeSet, withCodeLocation } from "@/lib/codes/data";
import { codeReport, RULES } from "@/lib/codes/rules";
import { cityById, placeFromCity } from "@/lib/location/cities";
import { buildSet } from "@/lib/plans/build";
import { sheetText } from "@/lib/plans/draw";
import { readiness } from "@/lib/plans/catalog";
import { codeReportPages } from "@/lib/plans/report";
import { sunShadeRatio } from "@/lib/plans/sheets/schedules";
import { house, onRealLot, RANCH, TWO_STORY, withKitchen } from "./samples";

const at = (p: Project, cityId: string | null): Project => ({ ...p, location: cityId ? placeFromCity(cityById(cityId)!) : null, plans: { ...p.plans, address: "123 Main St" } });

/** Every word printed on the sheets, the code check report and the Plans page's sheet list. */
function allText(p: Project): string {
  return withCodeLocation(p.location, () =>
    [...buildSet(p).flatMap(sheetText), ...codeReportPages(p, new Date(0)).flatMap(sheetText), ...readiness(p).sheets.flatMap((s) => s.reasons.map((r) => r.text))].join("\n"),
  );
}

const RANCH_LOT = onRealLot(withKitchen(house(RANCH)));
const HILLSIDE = house(TWO_STORY, 2, 1, 7);

describe("plans for any place", () => {
  it("names Denver on a Denver house's sheets, and never Boise or Idaho", () => {
    const p = at(RANCH_LOT, "denver-co");
    const text = allText(p);
    expect(text).toContain("123 MAIN ST, DENVER, COLORADO");
    expect(text).toContain("City and County of Denver, Colorado");
    expect(text).toContain("Verify all dimensions and code requirements with the City and County of Denver before construction.");
    expect(text).toContain("an engineer licensed in Colorado");
    expect(text).toContain("Denver Zoning Code");
    expect(text).not.toMatch(/boise|idaho|ada county|DOPL/i);
    const cover = withCodeLocation(p.location, () => buildSet(p).find((s) => s.number === "G-001")!);
    expect(sheetText(cover).join(" ")).toMatch(/DESIGN CRITERIA \(IRC TABLE R301\.2\(1\), DENVER\)/i);
  });

  it("gives a steep lot off Boise's list the plain engineer note", () => {
    const text = allText(at(HILLSIDE, "denver-co"));
    expect(text).toContain("Steep lots usually need an engineer-designed foundation.");
    expect(text).toContain("An engineer must design this foundation (steep lot)");
  });

  it("keeps Boise's own wording for a Boise house", () => {
    const text = allText(at(RANCH_LOT, "boise-id")) + allText(at(HILLSIDE, null));
    expect(text).toContain("123 MAIN ST, BOISE, IDAHO");
    expect(text).toContain("City of Boise, Ada County, Idaho");
    expect(text).toContain("Plan review by the City of Boise is the real check. Verify all dimensions and code requirements with the City of Boise before construction.");
    expect(text).toContain("Boise asks for an Idaho-licensed engineer to design hillside foundations.");
    expect(text).toContain("An engineer must design this foundation (Boise hillside rules)");
    expect(text).toContain("the State of Idaho (DOPL)");
    expect(text).toContain("None (not required for a house under the IRC as Idaho adopted it)");
    expect(text).toContain("(IRC Table R302.6 as amended by Idaho)");
    expect(text).toContain("Heat alarm in the garage, wired to the smoke alarms (Boise amendment).");
  });

  it("says just the state for a place off the list", () => {
    const text = allText(at(RANCH_LOT, "elsewhere-co"));
    expect(text).toContain("123 MAIN ST, COLORADO");
    expect(text).toContain("with the building department before construction");
    expect(text).toContain("your city or county zoning code");
  });

  it("titles the code check rules with the place's numbers", () => {
    const title = (cityId: string) => withCodeLocation(placeFromCity(cityById(cityId)!), () => RULES.find((r) => r.id === "garage-gypsum")!.title);
    expect(title("boise-id")).toContain('5/8"');
    expect(title("denver-co")).toContain('1/2"');
    // The report's section names follow the place too.
    const section = (cityId: string | null, id: string) => {
      const p = at(RANCH_LOT, cityId);
      return withCodeLocation(p.location, () => codeReport(p).find((r) => r.rule.id === id)?.section);
    };
    expect(section("boise-id", "setbacks")).toMatch(/Boise City Code Title 11/);
    expect(section("denver-co", "setbacks")).toMatch(/Denver Zoning Code/);
    expect(section("boise-id", "toilet-room")).toBe("UPC 402.5");
    expect(section("denver-co", "toilet-room")).toMatch(/^IRC /);
  });

  it("works out the summer sun's shade from the latitude", () => {
    expect(sunShadeRatio(43.6)).toBeCloseTo(0.37, 2);
    expect(sunShadeRatio(25.8)).toBeLessThan(0.1);
  });

  it("names no city or state in the plan, code or structure code outside the local code files", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (path.includes(join("data", "local"))) continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && /boise|idaho|ada county|treasure valley/i.test(readFileSync(path, "utf8"))) hits.push(path);
      }
    };
    // The base code file (data/irc-2021.json) keeps notes on where its old Boise numbers went; only code counts here.
    for (const dir of ["lib/plans", "lib/codes", "lib/structure", "components/plans"]) walk(dir);
    expect(hits).toEqual([]);
  });

  it("starts with Boise's names before a place is picked", () => {
    expect(codeSet().local.place).toBe("Boise, Idaho");
  });
});

describe("no place names left in the app's code", () => {
  it("names no city or state anywhere in lib/ or components/ except the default place and the old-project migration", () => {
    const hits: string[] = [];
    const allowed = ["lib/location/data", "lib/codes/data/local", "lib/location/current.ts", "lib/model/project.ts"];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (allowed.some((a) => path === a || path.startsWith(`${a}/`))) continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && /boise|idaho|ada county|treasure valley/i.test(readFileSync(path, "utf8"))) hits.push(path);
      }
    };
    for (const dir of ["lib", "components", "app"]) walk(dir);
    expect(hits).toEqual([]);
  });
});
