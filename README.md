# House Design App

Design a house from start to finish: pick land, sketch the flow, draw the floor plan, choose finishes, walk through it in 3D, and watch a running Boise, Idaho cost estimate. It runs on your own computer in a desktop browser.

## How to use it

1. Press **New project** on the home screen and name your house. The first time you open a house, a short guided tour shows you around (take it again any time with **Take the tour**, next to the stage bar).
2. Work through the seven steps in the stage bar, left to right: **Project setup**, **Land**, **Rooms**, **Flow sketch**, **Floor plan**, **Interior** and **Exterior**. You can go back to any step whenever you like.
3. Watch the **Cost** at the top right, and press **Walkthrough** to walk through the house once it has a floor plan. If one of those isn't ready yet, click it and it tells you what to do first.
4. Everything saves itself in this browser. **Undo** and **Redo** (⌘Z and ⇧⌘Z) go back step by step through everything you've done, and remember your last 30 steps even after you close the house. Hover either one to see what it will undo or redo; a note at the bottom of the window says what just changed. Switching between steps isn't counted, so Undo never just takes you to another page.
5. **3D: Fast / Pretty** (next to the stage bar, and in the walkthrough) sets how the 3D views are drawn on this computer. **Pretty** has shadows and smooth edges; **Fast** leaves them out and runs smoother, for older computers or very big houses.
6. Use **Export** now and then to keep a backup file.

## What's in it

The app was built in 11 milestones:

- **Milestone 1:** the home screen, project setup (your name and the house name), saving, and export/import.
- **Milestone 2:** land selection. Made-up plots around Boise, three at a time with arrows to see more (forever). Each plot shows in 3D (drag to turn it) or as a 2D map, with slope, sun paths, drainage, soil and water features. A perfectly flat plot is always first and one click away from the top bar.
- **Milestone 3:** the Rooms page (how many floors above and below ground, a checklist of rooms with optional sizes, floors and notes, which rooms connect, and how the house should feel), then an editable Design Brief (rooms and sizes, which rooms sit together, the feel, priorities).
- **Milestone 4:** the flow sketch. Rooms become circles and ovals sized to their area, placed by your land (entry toward the road, living spaces on the sunny side, daylight rooms on the downhill side of a walkout). Move, resize, rename and connect them, draw with a pen, erase, and leave sticky notes, one tab per floor with the floor below shown faintly. **Show me alternatives** puts three similar designs next to yours: use one, use it for one floor, or click a room in one to move just that room.
- **Flow sketch rework:** your lot line, Boise's sun paths, water, contours and a downhill arrow under the sketch (each one can be turned on or off), with **Move on lot** to slide the land under the house. Connect rooms from a checklist or by clicking them, select several things at once, draw rooms in any shape, and **Start over** to choose Start blank or a suggestion again.
- **Milestone 5, part 1:** the floor plan. A short **Plan basics** page first (ceiling heights, outside wall framing, garage, stairs and doors, all filled in with common Boise choices). Then **Turn my sketch into a plan** makes rooms with real walls from your flow sketch, with doors between connected rooms, a front door, a garage door and stairs that line up between floors. Or **Start blank** and draw your own. Walls appear around the rooms you draw, at any angle. Push walls, type exact lengths, reshape rooms, add extra walls, doors, windows, stairs and fixtures, and see the square footage as you go.
- **Milestone 5, part 2:** **Suggest a plan** does what Turn my sketch into a plan does, then adds what a real plan needs: hallways so bedrooms and baths don't open off each other, a stair hall around stairs that would otherwise stand outside the rooms, closets in bedrooms (a walk-in for a big primary bedroom), windows on outside walls (bigger and more on the sunny south side, one you could climb out of in every bedroom), and doors so every room can be reached. **Things to check** lists friendly warnings as you draw (a room with no door, a bedroom without a window you could climb out of, a narrow hallway, missing stairs, no front door, rooms much smaller or bigger than your brief) and clicking one jumps to it. **Show me alternatives** puts three variations next to your plan, each trying one change (a bigger kitchen, sizes closer to your brief, a mirror image and so on): use one, or just its floor.

- **Milestone 6, part 1:** the house in 3D. On the floor plan page, switch between **2D plan**, **Bird's-eye** (the current floor from straight above, with room names) and **3D** (the whole house on your land). Walls, doors, windows, floors, stairs and fixtures come straight from the plan, the house sits on the real slope of your lot with its foundation running down to the ground (a basement shows as a walkout on the downhill side), and the roof is built from the house's outline: gable, hip, shed or flat, with the steepness and overhang you pick. Click a room, door, window, stairs or fixture in 3D to select it and drag it to move it; the 2D plan changes with it.
- **Milestone 6, part 2:** the walkthrough. Press **Walkthrough** at the top of any project with a floor plan to walk through the house in first person, starting outside the front door. Walls stop you, doors and openings let you through, stairs take you between floors, outside doors and porches above the ground get steps, and you can walk out onto the land. A time of day slider and a season pick move the sun for Boise, so you can see where the light falls through the windows.
- **Milestone 7:** **Preview window.** Click a window (or sliding glass door) on an outside wall, in the 2D plan or in 3D edit mode, and press **Preview window**. Two pictures show what you'd see standing in the room looking out, and the window from outside on its wall (outlined in green). A season pick, a time slider and **Play** (the sun moves from sunrise to sunset over and over) show the light, and a line underneath says when direct sun comes in through that window in summer, spring and fall, and winter, counting the roof's overhang, other parts of the house and the hillside. The pictures follow along as you drag the window or change its size.
- **Milestone 9:** interior design. The **Interior** stage has three steps. **Style** asks about the look you want (style, wood tone, colors, metal finish, countertops, floors, carpet in bedrooms), filled in from what you wrote on the Rooms page where it can. **Mood board** shows paint colors and finishes that fit, with **Shuffle** for other matches. **Pick finishes** shows real products from a built-in catalog (flooring, tile, paint, trim, doors, cabinets, counters, hardware, sinks, faucets, appliances, vanities, toilets, shower trim and lighting), best match first, each with its price, the date it was last checked and a link to its page. Pick for the whole house, then change any room. Every pick updates the cost estimate, and the 3D view, walkthrough and window preview show the colors, with wood planks, tile and carpet drawn on the floors.
- **Design in the walkthrough:** turn on **Design** in the walkthrough (or press **E**) and the dot in the middle of the screen aims. Click a floor, wall, ceiling, counter, cabinet, appliance, fixture or inside door to pick its finish in a panel on the right, for this room or the whole house, and paint any single wall its own color (an accent wall). Add furniture (sofas, beds, tables, rugs and more) and move, turn and recolor it. Furniture isn't part of the cost, and it shows as outlines on the floor plan.
- **Furnish mode:** a **Furnish** stage after Floor plan has its own editor for everything that isn't the building itself: fixtures, cabinets, closets, appliances, outlets, lights, built-ins and extras (bookcases, window seats, shelves, ceiling fans, mirrors), and water, drain, gas, dryer vent and 240V hookups. The floor plan keeps the walls, doors and windows; in Furnish you can add walls and move or change doors and windows, but not delete any. **Furnish for me** fills in sensible defaults room by room. In the walkthrough, Design (**E**) and Place (**F**) are one panel, and **M** shows a top-down Furnish view. Furnish items show faded on the floor plan (with a **Show furnishings** switch). Built-ins, fireplaces, fans, bath accessories and hookups you add by hand are in the cost estimate ("Built-ins and extras" and "Extra hookups"), cabinets are priced from the actual cabinets, and furniture is not. The PDF plans draw built-ins on the floor plan, water, drain and gas stubs on the plumbing plan, your dryer vent on the mechanical plan, 240V circuits on the electrical plan, and a built-ins list in the fixture schedule.
- **Milestone 10:** exterior design. The **Exterior** stage has the same three steps. **Style** asks about the outside (style, siding, body color, accent, roof, roof color, window frames), guessed from your interior style where it can. **Mood board** shows the house's colors and matching products. **Pick finishes** has about 120 real products for the roof, siding, siding paint, an accent (stone, brick or wood, as a 3 ft band along the base or on the gable ends), trim paint, gutters, windows, front door, patio doors, garage doors, outdoor lights, decking, patio, front walk, driveway, lawn, planting beds, shrubs and trees. The 3D view and walkthrough draw them, with the yard laid out for you: a driveway from the garage to the road, a front walk, beds along the walls with shrubs, a few trees and lawn around the house. In the walkthrough's Design mode, aim at the outside of the house or the yard and click to change it. Every pick updates the cost estimate, which now counts the walk, lawn, beds, shrubs, trees and outdoor lights too.
- **Milestone 11:** polish. The guided tour, Undo and Redo that say what they'll do and remember your last 30 steps after you close a house, clearer messages when Cost or Walkthrough isn't ready yet, the **Fast / Pretty** 3D switch, and a faster cost estimate for big houses.

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
- **Wall lengths** and **Flow sketch** at the top turn the measurements and your sketch (drawn faintly under the plan) on or off. **Plan basics** changes ceiling heights, wall framing and the rest later; **Start over** goes back to the start choices, and **Undo** brings your plan back.
- **Things to check** (under the panel on the right) updates as you draw. Click a line to jump to that room, on whichever floor it's on. They're general guidelines for a comfortable house, not building code.
- **Show me alternatives:** rooms that changed have a purple outline. **Show me different ones** tries other ideas, **Back to my plan** keeps yours, and **Undo** brings yours back after you use one.

### 3D view tips

- **2D plan** and **3D** are at the top right of the floor plan. The floor tabs on the left pick the floor you're working on.
- **3D:** drag to turn the house, right-drag (or drag with two fingers) to slide it, and scroll to zoom. Tick **Look inside** to take off the roof and the floors above the one you picked.
- **Top view** (or tilting all the way down) looks straight down at the floor you picked, with room names.
- Press **Edit**, then click a room's floor, a door, a window, stairs or a fixture to select it (the panel on the right shows its details, like in 2D), then drag it to move it. Rooms snap to other rooms' corners, and doors and windows slide along their wall or hop to the nearest one. **Delete**, the arrow keys and **Undo** work as in 2D.
- **Roof** in the panel picks the shape (gable, hip, shed or flat), how steep it is and how far it reaches past the walls. Porches and covered patios get a roof on posts; decks stay open.
- Floors, walls, cabinets, counters, doors and appliances show the finishes picked on the Interior stage. Rooms with nothing picked are plain (light walls, wood floors, tile in bathrooms, carpet in bedrooms). The outside (siding, roof, windows, doors and yard) shows what's picked on the Exterior stage.

### Preview window tips

- The **Preview window** button is at the top of the panel on the right when a window or sliding glass door on an outside wall is selected. Windows on inside walls have no outside to see, so they don't get one.
- The popup stays open while you work: drag the window along its wall and the pictures follow. Click another window to switch to it. **Hide** folds it down to its title bar, and **Esc** or **✕** closes it.
- Drag its title bar to move it out of the way; it opens in the same spot next time.
- Drag either picture to look around a little. Double-click it to look straight at the window again.
- The direct sun times are worked out every 15 minutes on the longest day (summer), the spring equinox (spring and fall) and the shortest day (winter), in Boise clock time.

### Cost estimate tips

- The cost total is at the top right of every project once you've added rooms: **Materials about $270k ($240k to $340k)**. Click it to open the cost panel on the right. It stays open while you work, and the numbers change as you edit.
- Before there's a floor plan, the estimate is **rough**: it uses the room sizes from the Rooms page. Once you draw the floor plan, it's measured from the plan itself: floor areas, walls, the roof shape and pitch, doors and windows, fixtures, and the land's slope and drainage.
- Click a category to see what was measured, the rates, and where each rate came from. The estimate is **materials only**: labor, builder profit and contingency aren't included. Jobs usually hired out as a whole (site prep, digging, grading, drainage, rock removal, trenching, water service, well and septic) are full price, and permits and fees are included. The cost panel says so.
- **Water and sewer** switches between city hookups and a well and septic system.
- Cabinets are priced from the cabinets actually in your kitchen (and laundry or anywhere else you put them); a kitchen with none gets a typical one. Built-ins and extras and hookups placed in Furnish get their own lines; furniture isn't priced.
- Finishes (flooring, cabinets, fixtures and so on) are priced as mid-range until products are picked in the interior and exterior stages.
- Land is always $0. The estimate is for Boise, Idaho in 2026 and is not a bid.

### Interior design tips

- **Style** answers marked "From what you wrote on the Rooms page" are guesses from your words; click any choice to set it yourself. Click the second style again to clear it.
- On **Pick finishes**, start with **Whole house**: every room uses those picks unless it has its own. Then click a room on the left to change just that room. A number next to a room counts its own picks, and the list on the right shows what that room uses.
- Only the products that make sense for the room show (no toilets in the bedroom). Doors and baseboard are picked for the whole house.
- **View product** opens the product's page. Prices are what the page showed on the "last checked" date and may have changed since; **estimated** means the brand doesn't list a price, so it was worked out (hover to see how).
- In the cost panel, a picked product's name shows on its line. If only some rooms have a pick, the rest are still priced at mid-range.
- **See it in 3D** (under the picks) shows the house with the roof off, looking into the floor of the room you're picking for.

### Walkthrough tips

- **Walkthrough** is at the top right of every project once there's a floor plan. It fills the window.
- Click to start. Move the mouse to look around, **W A S D** or the arrow keys to walk, and hold **Shift** to walk faster.
- **Esc** gives you the mouse back, so you can use the time of day slider, the season and **Go to** (jump to any room, or back to the front door). Click the picture to keep walking. **Esc** again, or **Close walkthrough**, takes you back.
- Times are Boise clock times (with daylight saving time in summer and spring or fall), from sunrise to sunset.
- **Design** (or **E**) turns aiming on: a label under the dot names what you're looking at. Click it to open the panel, pick a product, then **Keep walking** (or click the picture). **Esc** closes the panel first. **This room**, **Whole house** and, for paint, **This wall** choose where a pick goes. **Undo** and **Redo** are at the top, and ⌘Z works too.
- **Add furniture** (or **F** while walking with Design on) puts a piece a few feet in front of you. It follows where you look until you click to put it down; **R** turns it (Shift+R the other way), **Esc** cancels. It turns red, and won't go down, where it would go through a wall or onto a counter or other furniture. Aim at a piece and click it to move, turn, recolor or remove it, or press **R** or **Delete** while aiming at it.

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

## No API key needed

Every suggestion (the Design Brief, the starting flow sketch, Suggest a plan and all the alternatives) is worked out by the app's own code on your computer, so there's nothing to sign up for or pay. If you added a `.env.local` file for a Claude key before, you can delete it with `rm .env.local`; nothing reads it anymore.

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

- `lib/house3d/` is the 3D house (`build.ts` turns the plan into triangles), the walkthrough (`walk.ts`), and the window preview: `windowView.ts` works out where to stand inside and outside a window, and `sunHours.ts` traces rays from the glass toward the sun to find when direct sun comes in. `sun.ts` has the seasons and Boise clock times shared by the walkthrough and the preview. The 3D views are in `components/house3d/` (React Three Fiber); `WindowPreview.tsx` draws the scene twice in one canvas, once from each camera.
- `lib/brief/` is the Design Brief: `rules.ts` builds a brief from the rooms page (`buildRuleBrief`) and `levels.ts` turns floor counts into levels.
- `lib/bubbles/` is the flow sketch. Bubbles are stored in inches with x pointing east and y pointing south, and a bubble's area always equals its room's square feet. `site.ts` picks a spot for each room: one of eight compass sides of the floor or the middle. `arrange.ts` turns spots into a drawing with the small force layout in `layout.ts` (same input, same drawing), lines the stairs up across floors, and adds missing rooms. `alternatives.ts` makes the alternatives and skips ones that would look the same as yours, `suggest.ts` is what the page calls for a starting sketch or alternatives, and `edit.ts` has the editing helpers. A drawn room is a `"free"` bubble with an outline around its middle; its `rx`/`ry` are half the outline's width and height so the layout code treats it like an oval. `land.ts` draws the lot, water, contours, downhill arrow and sun paths under the sketch (a plot point is the sketch point plus the saved `sketch.lotOffset`), and `start.ts` makes the blank sketch for Start blank. The canvas is in `components/bubbles/` (Konva).
- `lib/plan/` is the floor plan, in the same inches and coordinates as the flow sketch (so the lot offset is shared). Rooms come first: each `PlanRoom` is a polygon stored clockwise on screen, so the left side of every edge is outside. `walls.ts` derives the walls from the rooms: where two rooms' edges run along each other it's one inside wall, the rest are outside walls, and the open sides of a porch or deck get no wall. `walls` in the saved plan are only the extra walls drawn with the Wall tool. Doors and windows sit on a room edge (`{roomId, edge}`) or an extra wall (`{wallId}`) at a distance along it. `fromSketch.ts` turns sketch bubbles into rectangles of the same area, separates overlaps, slides them together, lines up near edges, then adds doors, stairs and hallway notes. `edit.ts` has the editing helpers (pushing a shared wall moves it for both rooms), `snap.ts` the snapping, `stairs.ts` sizes stairs from the rise between floors (risers up to 7 3/4", 10" treads), `basics.ts` the Plan basics defaults, `measure.ts` the square footage, and `catalog.ts` the door, window and fixture sizes. `connect.ts` says which rooms a door joins and what each room is for (living space, hallway, private room, part of the primary suite and so on). `suggest.ts` is Suggest a plan: stair halls, then hallways (it cuts the plan along a line, slides one side over by 3' 6" and puts the hallway in the gap, picking the cut that serves the most bedrooms and baths), doors, closets and windows. `checks.ts` makes the warnings. `changes.ts` applies small changes for alternatives (push a wall, swap two rooms, add or remove a door, open up a wall, add a window, flip the house) and checks each one: no rooms on top of each other, sensible sizes, no room cut off. A wall pushed into a room whose wall runs further gets a step, so nothing else moves. `alternatives.ts` has the ideas for alternatives, and `suggestPlanAlternatives` there is what the page calls. The canvas is in `components/plan/` (Konva), sharing the zoom, grid and overlay bits in `components/canvas/` and `components/bubbles/ViewOptions.tsx` with the flow sketch.

- `lib/cost/` is the cost estimate. `quantities.ts` measures the house (from the floor plan, or roughly from the Rooms page), including each room's share of the finish lines (`q.rooms`), `estimate.ts` multiplies by the rates and sorts the lines into the 16 categories, and `rates.ts` checks the rates file. The panel is `components/cost/CostPanel.tsx`. The estimate is worked out every time and never saved. `applySelections` in `estimate.ts` swaps the mid-range allowance for picked products room by room.
- `lib/catalog/` is the product catalog: `catalog.ts` loads and checks `data/catalog/*.json` and `config/brands.json`, and `categories.ts` lists the interior categories, the rooms each fits, and the cost line each replaces (with `share`, the part of the line's allowance a pick replaces, and `perUnit` to turn the line's unit into the product's). `lib/interior/` has the style questions and matching (`style.ts`: answers become tags, products score by shared tags) and the picks (`picks.ts`: a pick's `targetId` is a room id or `"house"`). The pages are in `components/interior/`. `lib/house3d/finishes.ts` turns picks into 3D colors and floor patterns, which `components/house3d/patternMaterial.ts` draws in the shader.

## How to update cost rates

All the prices live in one file: `lib/cost/data/cost-rates.json`. Each rate looks like this:

```json
"siding": {
  "label": "Fiber cement siding (painted)",
  "unit": "sqft",
  "material": [3.8, 4.8, 6.8],
  "source": "HomeGuide Hardie board siding cost",
  "url": "https://...",
  "checked": "2026-10-14"
}
```

- `material` is **[low, likely, high]** in dollars per unit. Keep them in that order (low ≤ likely ≤ high).
- `hired: true` marks a job usually hired out as a whole, whose `material` is its full price (material plus work).
- `unit` is `sqft`, `linft`, `each` or `cuyd` (cubic yards).
- Update `source`, `url` and `checked` when you change a number, so you know where it came from.
- `percents` holds the plan review fee. `permit` holds Boise's building permit table.
- Save the file and the app picks it up (restart `npm run dev` if it doesn't). If a number is mistyped, the app shows an error naming the rate, and `npm test` checks the file too.

## How to add or change a product

The interior products live in `data/catalog/`, one file per kind (`flooring.json`, `paint.json`, `kitchen-faucets.json` and so on). Each file is a list of products like this:

```json
{
  "id": "shaw-floorte-alto-natural",
  "name": "Floorte Pro Alto Mix, Natural Oak",
  "brand": "Shaw",
  "line": "Floorte Pro Alto Mix",
  "sku": "2032V-00290",
  "url": "https://www.homedepot.com/p/...",
  "price": 4.29,
  "unit": "sqft",
  "priceSource": "listed",
  "priceNote": "$4.29/sq ft at Home Depot",
  "lastChecked": "2026-10-15",
  "kind": "lvp",
  "styles": ["modern-farmhouse", "transitional"],
  "tags": ["light-wood", "warm"],
  "color": "#c8a77e",
  "pattern": "plank"
}
```

- To add one, copy an entry in the right file, give it a new `id` (any unique name with dashes), and change the rest.
- `hired: true` marks a job usually hired out as a whole, whose `material` is its full price (material plus work).
- `unit` is `sqft`, `each`, `linft`, `gallon` or `set`. `priceSource` is `listed` when the page shows the price, or `estimated` when you worked it out (say how in `priceNote`).
- `styles` are from: `modern-farmhouse`, `mountain-modern`, `scandinavian`, `craftsman`, `transitional`, `industrial`, `modern`. `tags` are from: `warm`, `cool`, `neutral`, `bold`, `light-wood`, `medium-wood`, `dark-wood`, `matte-black`, `brushed-nickel`, `brass`, `chrome`, `stainless`, `white`, `black`, `quartz`, `granite`, `butcher-block`, `concrete-look`. These decide which products show first for your style answers.
- `color` is the color used for the swatch and in 3D, and `pattern` is `plank`, `tile`, `stone`, `carpet`, `solid` or `metal`. Add `"imageUrl": "https://..."` to show a photo instead of the drawn swatch (many brand sites block their photos from showing elsewhere, so check it loads).
- `kind` sorts products within a file: for flooring `wood`, `lvp` or `carpet`; for tile `floor`, `wall` or `shower`; for lighting `pendant`, `chandelier`, `vanity`, `flush` or `sconce`. Copy it from a similar product.
- Update `price` and `lastChecked` when you check a price again.
- `config/brands.json` lists preferred brands for each kind; their products show a little higher when two match equally well.
- Save and the app picks it up. If something is mistyped, the app and `npm test` show an error naming the file and product.

### Outside products

The outside products live in the same folder: `roofing.json`, `siding.json`, `stone-brick.json`, `exterior-paint.json`, `gutters.json`, `windows.json`, `entry-doors.json`, `patio-doors.json`, `garage-doors.json`, `exterior-lighting.json`, `decking.json`, `pavers.json` and `landscaping.json`. Entries look the same, with a few differences:

- `styles` are from: `modern-farmhouse`, `mountain-modern`, `craftsman`, `contemporary`, `ranch`, `traditional`. `tags` are from: `white`, `light`, `neutral`, `warm`, `dark`, `earthy`, `bold`, `black`, `bronze`, `gray`, `wood-tone`, `red`, `blue`, `green`.
- `pattern` can also be `shingle`, `seam` (metal roofing), `lap`, `batten`, `shake`, `brick`, `stucco`, `grass` or `mulch`.
- `kind` decides where a product shows up and how it's priced: for roofing `shingle` or `metal`; for siding `lap`, `batten`, `shake`, `panel`, `stucco` or `brick`; for `stone-brick.json` `stone`, `brick` or `wood` (all accents); for `exterior-paint.json` `body` (siding paint) or `trim`; for `pavers.json` `driveway`, `patio`, `walk` or `gravel`; for `landscaping.json` `lawn`, `shrub`, `tree` or `mulch` (planting beds). Copy it from a similar product.
- Garage doors are priced per linear foot of door width (`linft`), windows and doors `each`, roofing, siding, decking and pavers per `sqft`.
