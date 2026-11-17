/** Descriptions des sous-wikis et résumés de discussions (§5.5, §8.4, §11.2). */
import { excerpt, systemPrompt, withSignal, type TaskContext } from "./context.ts";

export interface SummaryChildInput {
  title: string;
  type: string;
  /** Description du sous-wiki enfant, ou contenu de la page. */
  description: string;
  isSubwiki: boolean;
}

export interface SummaryInput {
  title: string;
  /** Titres des ancêtres, de la racine au parent. */
  path: readonly string[];
  content?: string;
  children: readonly SummaryChildInput[];
}

export function summaryMessage(input: SummaryInput): string {
  const children = input.children
    .map(
      (c) =>
        `- [${c.isSubwiki ? "sous-wiki" : c.type}] ${c.title} : ${excerpt(c.description || "(vide)", 1500).replace(/\n+/g, " ")}`,
    )
    .join("\n");
  return [
    "<mode>sous-wiki</mode>",
    "<page>",
    `Titre : ${input.title}`,
    `Chemin : ${[...input.path, input.title].join(" > ")}`,
    input.content?.trim() ? `Contenu :\n${excerpt(input.content, 4000)}` : "Contenu : (aucun)",
    "</page>",
    `<enfants>\n${children}\n</enfants>`,
  ].join("\n");
}

export async function summarizeNode(context: TaskContext, input: SummaryInput): Promise<string> {
  const text = await context.provider.complete(
    withSignal(context, {
      system: systemPrompt(context, "summarize"),
      messages: [{ role: "user" as const, content: summaryMessage(input) }],
      effort: "medium" as const,
    }),
  );
  return text.trim();
}

export interface DiscussionLine {
  role: "user" | "eugenia";
  content: string;
}

export async function summarizeDiscussion(
  context: TaskContext,
  input: { title: string; messages: readonly DiscussionLine[] },
): Promise<string> {
  const transcript = input.messages
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Eugenia"} : ${m.content}`)
    .join("\n\n");
  const text = await context.provider.complete(
    withSignal(context, {
      system: systemPrompt(context, "summarize"),
      messages: [
        {
          role: "user" as const,
          content: `<mode>discussion</mode>\n<titre>${input.title}</titre>\n<echange>\n${excerpt(transcript, 80000)}\n</echange>`,
        },
      ],
      effort: "medium" as const,
    }),
  );
  return text.trim();
}
