import type { Project } from "@/lib/model/schema";
import { exportAllFileName, exportAllJson, exportFileName, exportProjectJson } from "@/lib/storage/exchange";

/** Save a project as a .house.json file through the browser's download. */
export function downloadProject(project: Project) {
  downloadJson(exportProjectJson(project), exportFileName(project));
}

/** Save every house in one file ("Export all houses"). */
export function downloadAllProjects(projects: Project[]) {
  downloadJson(exportAllJson(projects), exportAllFileName());
}

/** A house's saved data exactly as stored (it may not open), for "Download its saved data". */
export function downloadSavedData(raw: unknown, name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  downloadJson(JSON.stringify(raw, null, 2), `${slug || "house"}.saved-data.json`);
}

function downloadJson(text: string, fileName: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  // Some browsers only download from a link on the page, and drop it if the link is freed right away.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
