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
    log.info(
      `${pages.length} page(s), dont ${pages.filter((n) => n.type === "flashcard").length} flashcard(s), ${pages.filter((n) => n.isPublic).length} publique(s).`,
    );
    if (problems.length === 0) log.info(green("Aucun problème détecté."));
    else reportProblems(log, problems);
  }
  return hasErrors(problems) ? 1 : 0;
}
