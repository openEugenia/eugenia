/** `eugenia validate`: checks the format of the wiki. */
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
      `${count("knowledge")} knowledge item(s), ${unsourced} of which need a source, ${count("flashcard")} flashcard(s), ${count("category")} category(ies), ${count("source")} source(s), ${wiki.tree.discussions.length} discussion(s); ${pages.filter((n) => n.isPublic).length} public page(s).`,
    );
    if (problems.length === 0) log.info(green("No problem found."));
    else reportProblems(log, problems);
  }
  return hasErrors(problems) ? 1 : 0;
}
