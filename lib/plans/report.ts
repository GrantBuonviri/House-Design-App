import type { Project } from "@/lib/model/schema";
import { codeEditions } from "@/lib/codes/data";
import { reportCounts } from "@/lib/codes/rules";
import { readiness } from "./catalog";
import { issueDate } from "./build";
import { preparedNote } from "./frame";
import { capHeight, line, table, textBlock, type Item, type Sheet } from "./draw";
import { codeRows } from "./sheets/general";
import { flatProject } from "@/lib/plan/flatten";

/**
 * The code check on its own, as letter-size pages (8.5" x 11") that print
 * on any printer: the codes used, the counts, and every rule with its result.
 */
export function codeReportPages(project: Project, date = new Date()): Sheet[] {
  project = flatProject(project);
  const r = readiness(project);
  const rows = codeRows(r.report).map(([n, title, section, result, found, fix]) => [n, `${title}\n${section}`, result, fix ? `${found}\nFix: ${fix}` : found]);
  const W = 8.5;
  const H = 11;
  const M = 0.6;
  const width = W - M * 2;
  const pages: Sheet[] = [];
  let start = 0;
  while (pages.length === 0 || start < rows.length) {
    const items: Item[] = [];
    let y = M;
    items.push({ t: "text", at: { x: M, y: y + capHeight(14) }, text: `${project.name}: code check`, size: 14, bold: true });
    items.push({ t: "text", at: { x: W - M, y: y + capHeight(8) }, text: issueDate(date), size: 8, align: "right" });
    y += 0.35;
    items.push({ t: "text", at: { x: M, y: y + capHeight(9) }, text: r.label, size: 9, bold: true });
    y += 0.25;
    if (pages.length === 0) {
      const counts = reportCounts(r.report);
      let b = textBlock(`${counts.pass} pass, ${counts.fail} fail, ${counts.manual} to check by hand. ${preparedNote(project)}`, M, y, width, 8);
      items.push(...b.items);
      y += b.height + 0.08;
      b = textBlock(codeEditions().map((e) => e.label.replace(/^[^:]+: /, "")).join(" · "), M, y, width, 7);
      items.push(...b.items);
      y += b.height + 0.08;
      b = textBlock("Plan review by the City of Boise is the real check. Verify all dimensions and code requirements with the City of Boise before construction.", M, y, width, 7);
      items.push(...b.items);
      y += b.height + 0.12;
    }
    items.push(line({ x: M, y }, { x: W - M, y }, "medium"));
    y += 0.12;
    const t = table(M, y, [
      { title: "#", width: 0.3 },
      { title: "Rule and code section", width: 2.6 },
      { title: "Result", width: 0.9 },
      { title: "What the app found", width: width - 3.8 },
    ], rows.slice(start), { size: 7, maxHeight: H - M - 0.3 - y });
    items.push(...t.items);
    start += Math.max(1, t.fitted);
    pages.push({ id: `report:${pages.length}`, number: "", title: "Code check", w: W, h: H, items });
    if (pages.length > 30) break;
  }
  pages.forEach((p, i) => p.items.push({ t: "text", at: { x: W / 2, y: H - M + 0.2 }, text: `Page ${i + 1} of ${pages.length}`, size: 7, align: "center" }));
  return pages;
}
