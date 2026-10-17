import type { Stage } from "@/lib/model/schema";

/**
 * The guided tour shown the first time you open a house (and any time from
 * the Tour button). Each step points at something on the page by its
 * `data-tour` name; a step with a `stage` switches to that stage first, so
 * the page behind the tour shows what the step talks about.
 */
export type TourStep = {
  /** The `data-tour` name of what to point at. Left out, the card sits in the middle. */
  target?: string;
  stage?: Stage;
  title: string;
  body: string;
};

export const TOUR: TourStep[] = [
  {
    title: "Welcome to your house",
    body: "This quick tour shows how a house comes together, from a piece of land to walking through it in 3D. Use Next and Back, or Skip to start right away.",
  },
  {
    target: "stages",
    title: "Six steps, left to right",
    body: "Work through these in order. You can jump back to any step whenever you like, and later steps follow your changes.",
  },
  {
    target: "stage-setup",
    stage: "setup",
    title: "1. Project setup",
    body: "Your name, a name for the house, and where you'll build it.",
  },
  {
    target: "place-picker",
    stage: "setup",
    title: "Where you'll build",
    body: "Type a city or a state and pick it. The place sets the sun and clock times, the weather the house is built for (snow, wind, frost, earthquakes) and the cost level. Every number can be edited.",
  },
  {
    target: "stage-land",
    stage: "land",
    title: "2. Land",
    body: "Pick a made-up plot, or design your own: set its size and shape, where north is, and the slope. Each plot has its own sun, drainage and road side, and those shape the rest of the design.",
  },
  {
    target: "stage-brief",
    stage: "brief",
    title: "3. Rooms",
    body: "Check the rooms you want and how many floors, then open any room to set its size, floor and what it should be next to. Your design brief keeps up on the right as you go.",
  },
  {
    target: "stage-bubbles",
    stage: "bubbles",
    title: "4. Flow sketch",
    body: "A loose sketch of where rooms go, drawn over your land with the sun path. The app can lay it out for you, and you drag things around.",
  },
  {
    target: "stage-plan",
    stage: "plan",
    title: "5. Floor plan",
    body: "Real walls, doors, windows, stairs and fixtures. Pick a room and drag the + on a wall to reshape it, or the diamond to bend a wall into a curve (Shift-click walls that meet to bend them together). Press C for the Curve tool, pick Round room in the Room tool, or right-click a corner or an outside wall to round it or add a half-round bay. Start from your sketch or a blank page, then switch to 3D to see the whole house on the land.",
  },
  {
    target: "stage-furnish",
    stage: "furnish",
    title: "6. Furnish",
    body: "Place furniture, cabinets, closets, fixtures, faucets, outlets and stair railings on each floor, or press Furnish for me to fill a room. Everything you place shows in 3D, the walkthrough and the cost.",
  },
  {
    target: "cost",
    title: "Running cost",
    body: "Once you pick rooms, a cost estimate for building where you picked on step one shows here and updates with every change. Click it for the breakdown.",
  },
  {
    target: "plans",
    title: "Building plans",
    body: "Plans makes PDF sheets for a building permit: floor plans, a cover sheet and a code check against the building codes. Each sheet says what it still needs.",
  },
  {
    target: "walkthrough",
    title: "Walk through and design",
    body: "Once there's a floor plan, walk through the house in first person. Press I for Interior design (style questions, a mood board, then real floors, paint and cabinets, room by room) and X for Exterior design (roof, siding, windows, doors and yard); the house changes as you pick. Press E to click any surface to change it, F to place furniture, fixtures, outlets, doors, windows and walls where you look, M to see the floor from above, L for room labels on the floor, T for a tape measure, and walk into doors to open them (click one to open or close it by hand, K to lock it).",
  },
  {
    target: "undo",
    title: "Undo anything",
    body: "Every change saves itself. Undo and Redo (⌘Z and ⇧⌘Z) go back step by step, and remember your last 30 steps even after you close the house. Hover them to see what they'll undo.",
  },
  {
    target: "graphics",
    title: "Fast or Pretty",
    body: "If the 3D views feel slow on this computer, switch to Fast. Pretty adds shadows and smoother edges.",
  },
  {
    target: "tour",
    title: "That's the tour",
    body: "You're back where you started. Take the tour again any time with this button.",
  },
];

/** Remembered in this browser once the tour is finished or skipped. */
export const TOUR_SEEN_KEY = "tour-seen";
