# House Design App

Design a house from start to finish: pick land, sketch the flow, draw the floor plan, choose finishes, walk through it in 3D, and watch a running Boise, Idaho cost estimate. It runs on your own computer in a desktop browser.

The app is built in milestones. So far it has:

- **Milestone 1:** the home screen, project setup (your name and the house name), saving, and export/import.
- **Milestone 2:** land selection. An endless feed of made-up plots around Boise, each with a shaded terrain map, slope, sun, drainage, soil and water features. A perfectly flat plot is always first in the feed and one click away from the top bar.

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

The app works without a key, using simpler built-in suggestions. AI features start in milestone 3.

1. Create a key at <https://console.anthropic.com> (this is separate from a Claude.ai plan and is billed by usage).
2. In the app folder, copy the example file: `cp .env.example .env.local`
3. Open `.env.local` in a text editor (`open -e .env.local`) and paste your key after `ANTHROPIC_API_KEY=`.
4. Stop the app (Ctrl C) and start it again with `npm run dev`. The Settings page shows whether the key was found.

`.env.local` is never uploaded to GitHub, and the key is only used by the app's server, never sent to the browser.

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
- `lib/land/` makes the land: `generate.ts` builds a plot from a seed (same seed, same plot), `terrain.ts` gives ground heights, `sun.ts` has Boise sun angles, and `implications.ts` turns a plot into foundation, sun, drainage and layout notes that later stages use.

How to add products and update cost rates will be documented here when those milestones land.
