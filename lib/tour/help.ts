import type { Stage } from "@/lib/model/schema";
import type { TourStep } from "./steps";
import { TOUR } from "./steps";

/** What each page's ? card says. The floor plan has its own longer card (`KeyboardHelp`). */
export type HelpCard = { title: string; lines: [string, string][] };

export const PAGE_HELP: Record<Exclude<Stage, "plan" | "interior" | "exterior">, HelpCard> = {
  setup: {
    title: "Project setup",
    lines: [
      ["Place", "Type a city or a state and pick it. Codes, sun, weather and costs follow it."],
      ["Edit a number", "Click any number in the place card to change it."],
      ["Next", "Press Continue, or click Land in the step bar."],
    ],
  },
  land: {
    title: "Land",
    lines: [
      ["Arrows", "Look at the next plots. Click one to pick it."],
      ["2D / 3D", "Switch how the plots are drawn."],
      ["My land", "Design your own plot: size, shape, north, slope and ground."],
    ],
  },
  brief: {
    title: "Rooms",
    lines: [
      ["Check a room", "Tick the rooms you want and set how many floors. Each one shows up under Your rooms."],
      ["Open a room", "Click its name to set the size, floor, notes and Next to. Duplicate adds another just like it."],
      ["Who it's for", "The household changes the starting room sizes."],
      ["Priorities", "Ticked ones change how sketches and plans are ranked."],
      ["Right panel", "Your brief, the living space and a rough materials cost, kept up to date as you go."],
    ],
  },
  bubbles: {
    title: "Flow sketch",
    lines: [
      ["Drag", "Move a bubble where you want that room."],
      ["Lay it out", "Let the app draw a first sketch, or show alternatives."],
      ["Floor tabs", "Switch floors above the sketch."],
    ],
  },
  furnish: {
    title: "Furnish",
    lines: [
      ["Click a catalog item", "Then click the floor plan to place it."],
      ["R", "Turn what's picked."],
      ["Delete", "Remove what's picked."],
      ["Arrow keys", "Nudge what's picked."],
      ["M", "Measure."],
      ["Esc", "Let go of what you're placing."],
    ],
  },
};

/** The legend shown in the walkthrough's Design mode. */
export const DESIGN_KEYS: [string, string][] = [
  ["E", "Click a surface to change it"],
  ["F", "Place something where you look"],
  ["Tab", "Switch Finishes and Place"],
  ["R", "Turn what you aim at"],
  ["Delete", "Remove what you aim at"],
  ["Scroll", "Raise or lower what you carry"],
  ["1 2 3", "Jump to a floor (what you carry comes too)"],
  ["Esc", "Cancel or leave the panel"],
];

/** Where the tour starts for the page you're on (the welcome step when no step is about it). */
export function tourStartFor(stage: Stage): number {
  const shown = stage === "interior" || stage === "exterior" ? "furnish" : stage;
  const i = TOUR.findIndex((s) => s.stage === shown && /^\d+\./.test(s.title));
  return i < 0 ? 0 : i;
}

export type MiniTour = { id: string; label: string; steps: TourStep[] };

/** Short "How do I..." tours. */
export const MINI_TOURS: MiniTour[] = [
  {
    id: "second-floor",
    label: "Add a second floor",
    steps: [
      { target: "stage-brief", stage: "brief", title: "Go to Rooms", body: "Floors are chosen on the Rooms page. Look for the number of floors and pick 2." },
      { target: "stage-bubbles", stage: "bubbles", title: "Place rooms upstairs", body: "On the Flow sketch, switch to the new floor with its tab and drag rooms onto it, or let the app lay them out." },
      { target: "stage-plan", stage: "plan", title: "Draw the upper floor", body: "On the Floor plan, pick the upper floor's tab. Stairs on the lower floor carry up with the Anchor button, and a room upstairs should sit on the floor below." },
    ],
  },
  {
    id: "change-finish",
    label: "Change a finish",
    steps: [
      { target: "walkthrough", title: "Open the walkthrough", body: "Walk into the room whose floor, paint or cabinets you want to change." },
      { target: "walkthrough", title: "Press E", body: "Press E, then click the surface. A list of real products opens. Pick one and the house changes right away." },
      { target: "walkthrough", title: "Or press I", body: "Press I for Interior design, which goes room by room through every finish." },
    ],
  },
  {
    id: "print-plans",
    label: "Print the plans",
    steps: [
      { target: "plans", title: "Open Plans", body: "The Plans button makes the PDF sheets. Each sheet says what it still needs." },
      { target: "plans", title: "Check the code check", body: "Read the code check sheet and Things to check on the Floor plan before you print." },
      { target: "plans", title: "Export", body: "Pick the sheets you want and use the download button in the Plans window. Print the PDF from your PDF viewer." },
    ],
  },
];
