/** `eugenia validate` : vérifie le format du wiki. */
import { hasErrors, validateWiki } from "@openeugenia/core";
import { loadDiskWiki } from "../fs-source.ts";
import { green, reportProblems, type Logger } from "../output.ts";

export interface ValidateOptions {
  dir: string;
  json: boolean;
  links: boolean;
}

export async function validateCommand(options: ValidateOptions, log: Logger): Promise<number> {
  const wiki = await loadDiskWiki(options.dir);
  const problems = await validateWiki(wiki.view, wiki.configProblems, { links: options.links });
  if (options.json) {
    log.info(JSON.stringify({ ok: !hasErrors(problems), problems }, null, 2));
  } else {
    const pages = [...wiki.tree.nodes.values()].filter((n) => !n.virtual);
    const count = (type: string): number => pages.filter((n) => n.type === type).length;
    const unsourced = pages.filter((n) => n.type === "knowledge" && !n.sourced).length;
    log.info(
      `${count("knowledge")} connaissance(s) dont ${unsourced} à sourcer, ${count("flashcard")} flashcard(s), ${count("category")} catégorie(s), ${count("source")} source(s), ${wiki.tree.discussions.length} discussion(s) ; ${pages.filter((n) => n.isPublic).length} page(s) publique(s).`,
    );
    if (problems.length === 0) log.info(green("Aucun problème détecté."));
    else reportProblems(log, problems);
  }
  return hasErrors(problems) ? 1 : 0;
}
