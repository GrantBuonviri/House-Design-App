# House Design App

Design a house from start to finish: pick land, sketch the flow, draw the floor plan, choose finishes, walk through it in 3D, and watch a running Boise, Idaho cost estimate. It runs on your own computer in a desktop browser.

The app is built in milestones. So far it has:

- **Milestone 1:** the home screen, project setup (your name and the house name), saving, and export/import.
- **Milestone 2:** land selection. Made-up plots around Boise, three at a time with arrows to see more (forever). Each plot shows in 3D (drag to turn it) or as a 2D map, with slope, sun paths, drainage, soil and water features. A perfectly flat plot is always first and one click away from the top bar.
- **Milestone 3:** the Rooms page (how many floors above and below ground, a checklist of rooms with optional sizes, floors and notes, which rooms connect, and how the house should feel), then an editable Design Brief (rooms and sizes, which rooms sit together, the feel, priorities). Works with or without a Claude API key.
- **Milestone 4:** the flow sketch. Rooms become circles and ovals sized to their area, placed by your land (entry toward the road, living spaces on the sunny side, daylight rooms on the downhill side of a walkout). Move, resize, rename and connect them, draw with a pen, erase, and leave sticky notes, one tab per floor with the floor below shown faintly. **Show me alternatives** puts three similar designs next to yours: use one, use it for one floor, or click a room in one to move just that room. Works with or without a Claude API key.
- **Flow sketch rework:** your lot line, Boise's sun paths, water, contours and a downhill arrow under the sketch (each one can be turned on or off), with **Move on lot** to slide the land under the house. Connect rooms from a checklist or by clicking them, select several things at once, draw rooms in any shape, and **Start over** to choose Start blank or a suggestion again.
- **Milestone 5, part 1:** the floor plan. A short **Plan basics** page first (ceiling heights, outside wall framing, garage, stairs and doors, all filled in with common Boise choices). Then **Turn my sketch into a plan** makes rooms with real walls from your flow sketch, with doors between connected rooms, a front door, a garage door and stairs that line up between floors. Or **Start blank** and draw your own. Walls appear around the rooms you draw, at any angle. Push walls, type exact lengths, reshape rooms, add extra walls, doors, windows, stairs and fixtures, and see the square footage as you go. Suggested hallways, closets and windows, alternatives and warnings come in part 2.

### Flow sketch tips

- Tools down the left side, or press a key: **V** select and move, **C** circle, **O** oval, **R** draw a room in any shape, **P** pen, **E** eraser, **N** note, **H** pan. **Delete** removes what's selected and **Esc** lets go of it and goes back to the select tool.
- **Shift-click** adds things to the selection or takes them out. Drag across empty space to select everything in a box. Drag any selected thing to move them all together.
- Zoom with a pinch on the trackpad, or hold **Control** and scroll. Scroll, hold the **Space** bar and drag, or use the pan tool to move around. **Fit** shows everything.
- Click a room to change its name, size, shape or floor in the panel on the right. Drag its handles to resize it, or to turn an oval or a drawn room.
- To connect rooms, click one and tick the rooms it connects to under **Connects to**, or press **Pick on drawing** and click rooms on the drawing.
- **Property line**, **Sun path** and **Land features** show the land you picked under the sketch. **Move on lot** slides the lot under your house; your rooms stay where they are.
- **Undo** and **Redo** at the top work for everything, including taking an alternative, moving the lot and **Start over**.

### Floor plan tips

- Tools down the left side, or press a key: **V** select and move, **R** room, **W** wall, **D** doors and windows, **S** stairs, **F** fixtures, **H** pan. **Delete** removes what's selected, the arrow keys nudge it, and **Esc** lets go of it.
- **Room:** drag to draw a rectangle, or click corner by corner for any shape and click the first corner (or press **Enter**) to close it. Walls show up on their own, and a wall two rooms share is one inside wall.
- **Select:** click a room, then drag one of its walls to push it (the room next door grows or shrinks with it), or drag a corner dot to reshape it. Double-click a wall to add a corner. Type an exact length for any wall in the panel on the right.
- **Wall** is for extra walls that aren't the edge of a room, like a half wall or a closet divider. Click at each turn and double-click or press **Enter** to finish.
- **Doors and windows:** pick one on the right, then click a wall. Drag it along the wall to move it, and use the panel to change its width, which way it swings and which side the hinges are on.
- Lines snap to corners, to lining up with other corners, and to a 6 inch grid. Hold **Shift** while drawing to keep a line at 45 degree steps. Untick **Snap to grid** at the top to place things freely.
- **Wall lengths** and **Flow sketch** at the top turn the measurements and your sketch (drawn faintly under the plan) on or off. **Plan basics** changes ceiling heights, wall framing and the rest later; **Start over** goes back to Start blank or Turn my sketch into a plan, and **Undo** brings your plan back.

## Run it on a Mac (first time)

1. **Install Node.js.** Go to <https://nodejs.org>, download the **LTS** version for macOS, and run the installer. Node.js has no app icon in Finder; you use it by typing commands in Terminal. To check it worked, open Terminal and run `node -v`.
2. **Install Git** if you don't have it. Open the **Terminal** app (press ⌘ Space, type "Terminal", press Enter) and run:
   ```sh
   git --version
   ```
   If a box pops up offering to install the command line developer tools, click **Install** and wait for it to finish.
3. **Download the app.** In Terminal:
   ```sh
   cd ~/Documents
   git clone https://github.com/GrantBuonviri/House-Design-App.git
   cd House-Design-App
   ```
4. **Install the app's libraries** (takes a minute):
   ```sh
   npm install
   ```
5. **Start it:**
   ```sh
   npm run dev
   ```
   Then open <http://localhost:3000> in your browser. Leave Terminal open while you use the app; press **Ctrl C** in Terminal to stop it.

## Get the latest version later

```sh
cd ~/Documents/House-Design-App
git pull
npm install
npm run dev
```

## Your Claude API key (optional)

The app works without a key, using simpler built-in suggestions. With a key, Claude fills in the Design Brief (sizes and floors for the rooms you left open, extra connections, the feel and a summary; it never adds or removes your rooms), lays out the starting flow sketch, and comes up with the alternatives.

1. Create a key at <https://console.anthropic.com> (this is separate from a Claude.ai plan and is billed by usage, so add a little credit under Billing).
2. In Terminal, in the app folder, copy the example file: `cp .env.example .env.local`
3. Open it in TextEdit with `open -e .env.local`, paste your key right after `ANTHROPIC_API_KEY=` (no spaces or quotes), and save.
4. Stop the app (Ctrl C) and start it again with `npm run dev`. The Settings page shows whether the key was found.

`.env.local` is never uploaded to GitHub, and the key is only used by the app's server, never sent to the browser.

What it costs: the brief and the starting flow sketch use Claude Haiku 5.5, the cheapest model, well under a cent each time. Flow sketch alternatives use Claude Opus 5.5, the most capable model, a few cents each time, and so will floor plans later on. Answers are saved, so asking the same thing twice is free. The Settings page keeps a running tally of what you've spent.

## Where your projects are saved

Projects live in your browser's storage (IndexedDB) on this computer. They stay there between visits, but clearing your browser's site data deletes them, and a different browser won't see them. Use **Export** on a project to save a `.house.json` backup file, and **Import project** on the home screen to bring one back.

## For developers

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with live reload |
| `npm test` | Run the tests (Vitest) |
| `npm run lint` | Check the code |
| `npm run build` | Production build |

- `lib/model/schema.ts` is the project data model (Zod schemas). Lengths are stored in inches and shown as feet and inches (`lib/model/units.ts`).
- `lib/model/project.ts` creates projects and migrates older saves. When the schema changes, bump `SCHEMA_VERSION` and add a migration step.
- `lib/store/projectStore.ts` is the Zustand store: every change goes through `update`, which records undo history and autosaves.
- `lib/storage/` holds IndexedDB saving (Dexie) and export/import.
- `lib/land/` makes the land: `generate.ts` builds a plot from a seed (same seed, same plot), `terrain.ts` gives ground heights, `sun.ts` has Boise sun angles, and `implications.ts` turns a plot into foundation, sun, drainage and layout notes that later stages use. `mesh.ts` turns a plot into 3D data (ground, water, draped lines) for `components/land/PlotTerrain3D.tsx` (React Three Fiber).

- `lib/brief/` is the Design Brief: `rules.ts` builds a brief from the rooms page without AI, `levels.ts` turns floor counts into levels, `ai.ts` merges what Claude returns while keeping the user's rooms, sizes and floors, and `service.ts` decides between Claude and the rules.
- `lib/bubbles/` is the flow sketch. Bubbles are stored in inches with x pointing east and y pointing south, and a bubble's area always equals its room's square feet. Claude (or `site.ts`, without a key) only picks a spot for each room: one of eight compass sides of the floor or the middle. `arrange.ts` turns spots into a drawing with the small force layout in `layout.ts` (same input, same drawing), lines the stairs up across floors, and adds missing rooms. `alternatives.ts` makes the built-in alternatives and skips ones that would look the same as yours, `edit.ts` has the editing helpers, `ai.ts` the prompts and `service.ts` decides between Claude and the rules. A drawn room is a `"free"` bubble with an outline around its middle; its `rx`/`ry` are half the outline's width and height so the layout code treats it like an oval. `land.ts` draws the lot, water, contours, downhill arrow and sun paths under the sketch (a plot point is the sketch point plus the saved `sketch.lotOffset`), and `start.ts` makes sure only the latest request to Claude can change the sketch. The canvas is in `components/bubbles/` (Konva).
- `lib/plan/` is the floor plan, in the same inches and coordinates as the flow sketch (so the lot offset is shared). Rooms come first: each `PlanRoom` is a polygon stored clockwise on screen, so the left side of every edge is outside. `walls.ts` derives the walls from the rooms: where two rooms' edges run along each other it's one inside wall, the rest are outside walls, and the open sides of a porch or deck get no wall. `walls` in the saved plan are only the extra walls drawn with the Wall tool. Doors and windows sit on a room edge (`{roomId, edge}`) or an extra wall (`{wallId}`) at a distance along it. `fromSketch.ts` turns sketch bubbles into rectangles of the same area, separates overlaps, slides them together, lines up near edges, then adds doors, stairs and hallway notes. `edit.ts` has the editing helpers (pushing a shared wall moves it for both rooms), `snap.ts` the snapping, `stairs.ts` sizes stairs from the rise between floors (risers up to 7 3/4", 10" treads), `basics.ts` the Plan basics defaults, `measure.ts` the square footage, and `catalog.ts` the door, window and fixture sizes. The canvas is in `components/plan/` (Konva), sharing the zoom, grid and overlay bits in `components/canvas/` and `components/bubbles/ViewOptions.tsx` with the flow sketch.
- `lib/ai/` calls Claude from the server (`run.ts`), with the model choices and prices in `models.ts`. Saved answers and the spend tally live in `.app-data/` in the app folder (not uploaded to GitHub). Delete that folder to clear them.

How to add products and update cost rates will be documented here when those milestones land.
