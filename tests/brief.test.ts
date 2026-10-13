import { describe, expect, it } from "vitest";
import { DiscoveryAnswers, type DesignBrief, type Profile } from "@/lib/model/schema";
import { createProject, migrateProject } from "@/lib/model/project";
import { FLAT_PLOT_SEED, generatePlot } from "@/lib/land/generate";
import { buildRuleBrief, briefTotals, wantsBasement, type BriefContext } from "@/lib/brief/rules";
import { ruleFollowUps, MAX_FOLLOW_UPS } from "@/lib/brief/followups";
import { briefFromAi, briefToAiShape, type AiBrief } from "@/lib/brief/ai";
import { levelIdsFor, syncLevels } from "@/lib/brief/levels";
import { roomType } from "@/lib/brief/rooms";

const profile: Profile = { mustHaves: [], dislikes: [] };
const flat = generatePlot(FLAT_PLOT_SEED, { flat: true });

function ctx(answers: Partial<DiscoveryAnswers> = {}, extra: Partial<BriefContext> = {}): BriefContext {
  return { answers: DiscoveryAnswers.parse(answers), profile, plot: flat, followUps: [], ...extra };
}

function sloped(min: number, max: number) {
  for (let seed = 2; seed < 2000; seed++) {
    const p = generatePlot(seed);
    if (p.slope.percent >= min && p.slope.percent < max) return p;
  }
  throw new Error("no plot in range");
}

/** Every link points at real rooms and every room sits on a floor that exists. */
function expectConsistent(brief: DesignBrief) {
  const ids = new Set(brief.rooms.map((r) => r.id));
  expect(ids.size).toBe(brief.rooms.length);
  for (const e of brief.adjacencies) {
    expect(ids.has(e.a)).toBe(true);
    expect(ids.has(e.b)).toBe(true);
    expect(e.a).not.toBe(e.b);
  }
  const levels = levelIdsFor(brief.floors, brief.basement) as string[];
  for (const r of brief.rooms) expect(levels).toContain(r.levelId);
}

describe("rule-based brief", () => {
  it("builds a sensible default house", () => {
    const b = buildRuleBrief(ctx());
    expectConsistent(b);
    const types = b.rooms.map((r) => r.type);
    expect(types).toContain("kitchen");
    expect(types).toContain("primary-bedroom");
    expect(types.filter((t) => t === "bedroom")).toHaveLength(2);
    expect(b.rooms.find((r) => r.type === "garage")?.targetSqFt).toBe(530);
    expect(b.basement).toBe(false);
    expect(b.source).toBe("rules");
    expect(b.summary).toMatch(/3 bedrooms, 2.5 baths/);
    const kitchen = b.rooms.find((r) => r.type === "kitchen")!.id;
    const dining = b.rooms.find((r) => r.type === "dining")!.id;
    expect(b.adjacencies).toContainEqual({ a: kitchen, b: dining, strength: "must" });
  });

  it("puts bedrooms upstairs in a two-story house, unless everything must be on one floor", () => {
    const two = buildRuleBrief(ctx({ floors: 2, primarySuite: "upper" }));
    expectConsistent(two);
    expect(two.rooms.filter((r) => r.type.includes("bedroom")).every((r) => r.levelId === "upper")).toBe(true);

    const oneFloor = buildRuleBrief(ctx({ floors: 2, primarySuite: "upper", accessibility: ["Everything needed on one floor"] }));
    expect(oneFloor.rooms.filter((r) => r.type.includes("bedroom")).every((r) => r.levelId === "main")).toBe(true);
  });

  it("adds a basement only where the land suits it, when asked to decide", () => {
    expect(wantsBasement(DiscoveryAnswers.parse({}), flat)).toBe(false);
    const hill = sloped(9, 14);
    const b = buildRuleBrief(ctx({ extraRooms: ["Media room"] }, { plot: hill }));
    expect(b.basement).toBe(true);
    expectConsistent(b);
    expect(b.rooms.find((r) => r.type === "media")?.levelId).toBe("basement");
    expect(b.priorities.some((p) => p.startsWith("Walkout basement"))).toBe(true);
    expect(buildRuleBrief(ctx({ basement: "no" }, { plot: hill })).basement).toBe(false);
  });

  it("makes rooms a little bigger for an airy feel", () => {
    const cozy = briefTotals(buildRuleBrief(ctx({ cozyAiry: 0 })));
    const airy = briefTotals(buildRuleBrief(ctx({ cozyAiry: 100 })));
    expect(airy.heated).toBeGreaterThan(cozy.heated * 1.1);
  });

  it("keeps the user's own words and follow-up answers", () => {
    const b = buildRuleBrief(
      ctx(
        { dailyRoutine: "Coffee on the porch at 6." },
        { followUps: [{ id: "x", question: "Host often?", options: [], answer: "Every Friday" }] },
      ),
    );
    expect(b.freeText).toContain("Coffee on the porch at 6.");
    expect(b.freeText).toContain("Every Friday");
  });
});

describe("rule-based follow-up questions", () => {
  it("asks about shared rooms when there are more kids than bedrooms", () => {
    const qs = ruleFollowUps({ ...ctx({ bedrooms: 2 }), profile: { ...profile, kids: 3 } });
    expect(qs[0].question).toMatch(/share/);
    expect(qs.length).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
  });

  it("always has something to ask", () => {
    expect(ruleFollowUps(ctx()).length).toBeGreaterThan(0);
  });
});

describe("repairing Claude's brief", () => {
  const draft = buildRuleBrief(ctx());
  const ai = (over: Partial<AiBrief> = {}): AiBrief => ({ ...briefToAiShape(draft), summary: "A calm house.", ...over });

  it("accepts a good brief and keeps the user's notes", () => {
    const b = briefFromAi(ai(), draft);
    expect(b.source).toBe("ai");
    expect(b.summary).toBe("A calm house.");
    expect(b.freeText).toBe(draft.freeText);
    expect(b.adjacencies.length).toBe(draft.adjacencies.length);
    expectConsistent(b);
  });

  it("clamps sizes, moves rooms off floors that don't exist and makes names unique", () => {
    const rooms = [
      { type: "kitchen", name: "Kitchen", sqft: 5000, level: "main" as const, notes: "" },
      { type: "bedroom", name: "Bedroom", sqft: 10, level: "upper-2" as const, notes: "" },
      { type: "bedroom", name: "Bedroom", sqft: 150, level: "basement" as const, notes: "" },
      { type: "living", name: "Living", sqft: Number.NaN, level: "main" as const, notes: " Big windows " },
    ];
    const b = briefFromAi(
      ai({ floors: 1, basement: false, rooms, adjacencies: [{ a: "Kitchen", b: "Nowhere", strength: "must" }, { a: "kitchen", b: "living", strength: "must" }] }),
      draft,
    );
    expect(b.rooms[0].targetSqFt).toBe(roomType("kitchen").max);
    expect(b.rooms[1].targetSqFt).toBe(roomType("bedroom").min);
    expect(b.rooms.map((r) => r.name)).toEqual(["Kitchen", "Bedroom", "Bedroom 2", "Living"]);
    expect(b.rooms.every((r) => r.levelId === "main")).toBe(true);
    expect(b.rooms[3].targetSqFt).toBe(roomType("living").sqft);
    expect(b.rooms[3].notes).toBe("Big windows");
    expect(b.adjacencies).toEqual([{ a: "kitchen", b: "living", strength: "must" }]);
    expectConsistent(b);
  });

  it("falls back to the draft when there's no kitchen", () => {
    const b = briefFromAi(ai({ rooms: ai().rooms.filter((r) => r.type !== "kitchen") }), draft);
    expect(b).toBe(draft);
  });
});

describe("levels", () => {
  it("matches the project's levels to the brief", () => {
    const project = createProject("Test");
    const brief = buildRuleBrief(ctx({ floors: 2, basement: "yes" }));
    expect(syncLevels(project.levels, brief).map((l) => l.id)).toEqual(["basement", "main", "upper"]);
    const one = buildRuleBrief(ctx({ floors: 1, basement: "no" }));
    expect(syncLevels(project.levels, one).map((l) => l.id)).toEqual(["main"]);
  });

  it("opens projects saved before the questions existed", () => {
    const old = createProject("Old") as Record<string, unknown>;
    delete old.discovery;
    const p = migrateProject(JSON.parse(JSON.stringify(old)));
    expect(p.discovery.answers.bedrooms).toBe(3);
    expect(p.discovery.followUps).toEqual([]);
  });
});
