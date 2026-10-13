import type { FollowUp } from "@/lib/model/schema";
import { plotImplications } from "@/lib/land/implications";
import { compassName } from "@/lib/land/sun";
import { wantsBasement, type BriefContext } from "./rules";

export const MAX_FOLLOW_UPS = 4;

type Draft = Omit<FollowUp, "id" | "answer">;

/**
 * Follow-up questions picked by simple rules: the gaps and tensions in the
 * answers, and what the land suggests. Used without an API key.
 */
export function ruleFollowUps(ctx: Omit<BriefContext, "followUps">): FollowUp[] {
  const { answers: a, profile, plot } = ctx;
  const out: Draft[] = [];
  const kids = profile.kids ?? 0;

  if (kids > 0 && a.bedrooms - 1 < kids) {
    out.push({
      question: `With ${kids} ${kids === 1 ? "kid" : "kids"} and ${a.bedrooms} bedrooms, will some kids share a room?`,
      why: "Shared rooms want a little more space and their own closets.",
      options: ["Yes, they'll share", "No, add a bedroom", "For now, then they'll split"],
    });
  }
  if ((profile.workFromHome ?? 0) > a.offices) {
    out.push({
      question: `${profile.workFromHome} people work from home but there ${a.offices === 1 ? "is 1 office" : `are ${a.offices} offices`}. Where will the others work?`,
      why: "Video calls need a door that closes.",
      options: ["Add another office", "A nook in the living area", "A bedroom doubles as an office"],
    });
  }
  if (a.floors > 1 && (profile.olderRelatives || a.accessibility.length > 0) && a.primarySuite !== "main") {
    out.push({
      question: "Should there be a bedroom and full bath on the main floor, so stairs are optional?",
      why: "Useful for older relatives, injuries, or staying in the house as you age.",
      options: ["Yes", "No, stairs are fine"],
    });
  }
  if (plot) {
    const imp = plotImplications(plot);
    if (wantsBasement(a, plot) && (imp.foundation.type === "walkout" || imp.foundation.type === "stepped")) {
      out.push({
        question: `Your land slopes ${plot.slope.percent.toFixed(0)}% down to the ${compassName(plot.slope.downhillDeg)}, which suits a walkout basement. What would you use it for?`,
        why: "A walkout gets daylight and its own door, so it can hold real rooms.",
        options: ["Family or rec room", "Guest suite", "Storage and a workshop", "Keep it unfinished for now"],
      });
    }
    const water = plot.waterFeatures.find((w) => w.kind !== "wash");
    if (water) {
      const name = water.kind === "lake" ? "the lake" : `the ${water.kind}`;
      out.push({
        question: `Which rooms should look out toward ${name}?`,
        why: "Views decide which side of the house gets the big windows.",
        options: ["Living and kitchen", "Primary bedroom", "As many rooms as possible"],
      });
    }
  }
  if (a.quietEntertaining > 65) {
    out.push({
      question: "When you host, how many people usually come over?",
      why: "Sets the size of the dining table, kitchen island and living room.",
      options: ["Under 8", "8 to 15", "Big parties, 20 or more"],
    });
  }
  if (a.garageBays >= 3) {
    out.push({
      question: "What is the extra garage space for?",
      why: "A shop or toy bay may need a taller door, power, or a deeper bay.",
      options: ["A third car", "Boat, RV or trailer", "Workshop", "Bikes and gear"],
    });
  }
  if (a.indoorOutdoor === "lots" && a.outdoor.length === 0) {
    out.push({
      question: "You want lots of indoor-outdoor connection. What outdoor space would you use most?",
      options: ["A covered patio", "A deck", "A screened porch", "A garden courtyard"],
    });
  }
  // Always useful if there's room left.
  out.push({
    question: "What did you dislike most about places you've lived before?",
    why: "Knowing what to avoid is as useful as knowing what you want.",
    options: [],
  });
  out.push({
    question: "Where do you want to be on a slow Saturday morning?",
    options: ["Kitchen island with coffee", "A sunny reading nook", "Out on the patio"],
  });

  return out.slice(0, MAX_FOLLOW_UPS).map((d, i) => ({ ...d, id: `rule-${i + 1}`, answer: "" }));
}
