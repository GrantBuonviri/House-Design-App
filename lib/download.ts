import type { Project } from "@/lib/model/schema";
import { exportFileName, exportProjectJson } from "@/lib/storage/exchange";

/** Save a project as a .house.json file through the browser's download. */
export function downloadProject(project: Project) {
  const blob = new Blob([exportProjectJson(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(project);
  a.click();
  URL.revokeObjectURL(url);
}
