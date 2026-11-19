/**
 * Copie de travail d'un wiki dans le navigateur : instantané distant, modifications en
 * attente, caches de contenus (mémoire et IndexedDB, adressés par SHA) et état dérivé
 * (arbre, descriptions, maîtrise).
 */
import {
  basename,
  buildTree,
  CONFIG_PATH,
  dirname,
  discussionMeta,
  discussionNodes,
  filesToLoad,
  isContentPath,
  isDiscussionPath,
  nodeForPath,
  pageIndexPaths,
  pageMeta,
  parseConfig,
  parseDiscussion,
  parseSummary,
  PROMPTS_DIR,
  quizEvents,
  replayMastery,
  spaceOf,
  spaceRootPath,
  summaryStates,
  type CardState,
  type DiscussionMeta,
  type PageMeta,
  type QuizEvent,
  type RepoFile,
  type SummaryDocument,
  type SummaryState,
  type WikiConfig,
  type WikiTree,
  type WikiView,
} from "@openeugenia/core";
import { isPromptName, type PromptOverrides } from "@openeugenia/ai/prompts";
import type { Backend } from "./backend.ts";
import { getBlobs, putBlobs, type Snapshot } from "./db.ts";
import { workingFiles, type PendingState } from "./pending.ts";

/** Discussion du dossier des discussions, avec ses métadonnées. */
export interface DiscussionEntry {
  path: string;
  meta: DiscussionMeta;
}

export interface Derived {
  config: WikiConfig;
  configProblems: string[];
  files: Map<string, RepoFile>;
  tree: WikiTree;
  summaries: Map<string, SummaryDocument>;
  /** Toutes les discussions (questions, quiz, notes rapides), de la plus récente à la plus ancienne. */
  discussions: DiscussionEntry[];
  /** Discussions rattachées à chaque page (page d'origine ou périmètre). */
  discussionsByNode: Map<string, DiscussionEntry[]>;
  /** Discussion d'après son identifiant (connaissances extraites d'une discussion). */
  discussionById: Map<string, DiscussionEntry>;
  /** Connaissances qui citent chaque source, ou en ont été extraites. */
  knowledgeBySource: Map<string, string[]>;
  quizEvents: QuizEvent[];
  mastery: Map<string, CardState>;
  summaryStates: { private: Map<string, SummaryState>; public: Map<string, SummaryState> };
  /** Nœuds ayant des modifications non synchronisées. */
  pendingNodes: Set<string>;
  prompts: PromptOverrides;
  /** Le dépôt ne contient pas encore de wiki. */
  empty: boolean;
}

const textDecoder = new TextDecoder();

export class Workspace implements WikiView {
  private texts = new Map<string, string>();
  private metaCache = new Map<string, PageMeta>();
  private summaryCache = new Map<string, SummaryDocument>();
  private discussionCache = new Map<string, { meta: DiscussionMeta; events: QuizEvent[] }>();
  private filesCache: Map<string, RepoFile> | null = null;
  derived: Derived | null = null;

  constructor(
    readonly key: string,
    public snapshot: Snapshot,
    public pending: PendingState,
    readonly backend: Backend,
    private readonly persist = true,
  ) {}

  get mode(): "owner" | "anonymous" {
    return this.snapshot.mode;
  }

  /** Remplace l'instantané ou l'état en attente (invalide la vue de travail). */
  update(snapshot: Snapshot, pending: PendingState): void {
    this.snapshot = snapshot;
    this.pending = pending;
    this.filesCache = null;
  }

  get files(): Map<string, RepoFile> {
    this.filesCache ??= workingFiles(this.snapshot.files, this.pending);
    return this.filesCache;
  }

  get config(): WikiConfig {
    return this.derived?.config ?? parseConfig(null).config;
  }

  get tree(): WikiTree {
    if (!this.derived) throw new Error("Wiki non chargé.");
    return this.derived.tree;
  }

  /** Contenu connu sans réseau (en mémoire), ou `undefined`. */
  peekText(path: string): string | undefined {
    const change = this.pending.changes[path];
    if (change?.kind === "write" && change.content !== undefined) return change.content;
    const file = this.files.get(path);
    return file ? this.texts.get(file.sha) : undefined;
  }

  async readText(path: string): Promise<string> {
    const change = this.pending.changes[path];
    if (change?.kind === "write") {
      if (change.content !== undefined) return change.content;
      if (change.base64 !== undefined)
        return textDecoder.decode(Uint8Array.from(atob(change.base64), (c) => c.charCodeAt(0)));
    }
    const file = this.files.get(path);
    if (!file) throw new Error(`Fichier introuvable : ${path}`);
    const cached = this.texts.get(file.sha);
    if (cached !== undefined) return cached;
    await this.prefetch([file]);
    const text = this.texts.get(file.sha);
    if (text === undefined) throw new Error(`Contenu indisponible hors ligne : ${path}`);
    return text;
  }

  /** Charge en lot les contenus manquants : mémoire, puis IndexedDB, puis réseau. */
  async prefetch(files: Iterable<RepoFile>): Promise<void> {
    const missing = new Map<string, RepoFile>();
    for (const file of files) {
      if (!this.texts.has(file.sha) && !this.pendingContent(file.path)) missing.set(file.sha, file);
    }
    if (missing.size === 0) return;
    if (this.persist) {
      const stored = await getBlobs(this.key, [...missing.keys()]).catch(
        () => new Map<string, string>(),
      );
      for (const [sha, content] of stored) {
        this.texts.set(sha, content);
        missing.delete(sha);
      }
    }
    if (missing.size === 0) return;
    const fetched = await this.backend.readBlobs([...missing.values()]);
    for (const [sha, content] of fetched) this.texts.set(sha, content);
    if (this.persist) await putBlobs(this.key, fetched).catch(() => undefined);
  }

  /**
   * Charge en un lot tous les fichiers Markdown du wiki (avant un renommage, un déplacement
   * ou une suppression, qui réécrivent les liens de tous les fichiers).
   */
  async prefetchMarkdown(): Promise<void> {
    const config = this.config;
    const files = [...this.files.values()].filter(
      (f) => f.path.endsWith(".md") && isContentPath(config, f.path),
    );
    await this.prefetch(files);
  }

  /** Mémorise des contenus connus (après un commit, par exemple). */
  async remember(contents: ReadonlyMap<string, string>): Promise<void> {
    for (const [sha, content] of contents) this.texts.set(sha, content);
    if (this.persist) await putBlobs(this.key, contents).catch(() => undefined);
  }

  private pendingContent(path: string): boolean {
    const change = this.pending.changes[path];
    return change?.kind === "write";
  }

  async readBinary(path: string): Promise<Blob> {
    const change = this.pending.changes[path];
    if (change?.kind === "write" && change.base64 !== undefined) {
      const bytes = Uint8Array.from(atob(change.base64), (c) => c.charCodeAt(0));
      return new Blob([bytes]);
    }
    if (change?.kind === "write" && change.content !== undefined) return new Blob([change.content]);
    const file = this.files.get(path);
    if (!file) throw new Error(`Fichier introuvable : ${path}`);
    return this.backend.readBinary(file);
  }

  /** Recalcule l'état dérivé à partir de la vue de travail. */
  async derive(): Promise<Derived> {
    const files = this.files;
    const configFile = files.get(CONFIG_PATH);
    if (configFile) await this.prefetch([configFile]);
    const { config, problems } = parseConfig(configFile ? await this.readText(CONFIG_PATH) : null);
    const owner = this.mode === "owner";
    const metasFromIndex = this.snapshot.metas;
    const discussionsFromIndex = this.snapshot.discussions;

    // Contenus nécessaires : pages et discussions (sauf index anonyme), descriptions
    // (propriétaire), prompts.
    const toLoad = new Set<string>();
    const indexPaths = pageIndexPaths(config, files.keys());
    if (owner) for (const path of filesToLoad(config, files.keys())) toLoad.add(path);
    else {
      for (const path of indexPaths)
        if (!metasFromIndex?.[path] || this.pending.changes[path]) toLoad.add(path);
      for (const path of files.keys())
        if (isDiscussionPath(config, path) && !discussionsFromIndex?.[path]) toLoad.add(path);
    }
    for (const path of files.keys()) if (dirname(path) === PROMPTS_DIR) toLoad.add(path);
    await this.prefetch([...toLoad].map((p) => files.get(p)!).filter(Boolean));

    const metas = new Map<string, PageMeta>();
    for (const path of indexPaths) {
      const file = files.get(path)!;
      const fromIndex = !this.pending.changes[path] ? metasFromIndex?.[path] : undefined;
      if (fromIndex) {
        metas.set(path, fromIndex);
        continue;
      }
      let meta = this.metaCache.get(file.sha);
      if (!meta) {
        const text = this.peekText(path);
        if (text === undefined) continue;
        meta = pageMeta(text);
        this.metaCache.set(file.sha, meta);
      }
      metas.set(path, meta);
    }
    const tree = buildTree({ config, files: files.values(), metas });

    const summaries = new Map<string, SummaryDocument>();
    for (const node of tree.nodes.values()) {
      for (const file of [node.summaries.private, node.summaries.public]) {
        if (!file) continue;
        let doc = this.summaryCache.get(file.sha);
        if (!doc) {
          const text = this.peekText(file.path);
          if (text === undefined) continue;
          doc = parseSummary(text);
          this.summaryCache.set(file.sha, doc);
        }
        summaries.set(file.path, doc);
      }
    }

    // Discussions : métadonnées (liste, rattachement aux pages) et évaluations des quiz.
    const events: QuizEvent[] = [];
    const discussions: DiscussionEntry[] = [];
    for (const file of tree.discussions) {
      const fromIndex = !this.pending.changes[file.path]
        ? discussionsFromIndex?.[file.path]
        : undefined;
      if (fromIndex) {
        discussions.push({ path: file.path, meta: fromIndex });
        continue;
      }
      let parsed = this.discussionCache.get(file.sha);
      if (!parsed) {
        const text = this.peekText(file.path);
        if (text === undefined) continue;
        parsed = { meta: discussionMeta(text), events: quizEvents(parseDiscussion(text)) };
        this.discussionCache.set(file.sha, parsed);
      }
      discussions.push({ path: file.path, meta: parsed.meta });
      for (const event of parsed.events) events.push({ ...event, source: file.path });
    }
    const discussionsByNode = new Map<string, DiscussionEntry[]>();
    const discussionById = new Map<string, DiscussionEntry>();
    for (const entry of discussions) {
      if (entry.meta.id) discussionById.set(entry.meta.id, entry);
      for (const id of discussionNodes(entry.meta)) {
        discussionsByNode.set(id, [...(discussionsByNode.get(id) ?? []), entry]);
      }
    }
    const knowledgeBySource = new Map<string, string[]>();
    for (const node of tree.nodes.values()) {
      if (node.type !== "knowledge") continue;
      const sources = new Set(node.refs);
      if (node.extractedFrom) sources.add(node.extractedFrom);
      for (const id of sources) {
        knowledgeBySource.set(id, [...(knowledgeBySource.get(id) ?? []), node.id]);
      }
    }

    const cards = [...tree.nodes.values()]
      .filter((n) => n.type === "flashcard")
      .map((n) => (n.created ? { id: n.id, created: n.created } : { id: n.id }));
    const mastery = replayMastery(cards, events, config.mastery);

    const pendingNodes = new Set<string>();
    for (const path of Object.keys(this.pending.changes)) {
      const space = spaceOf(config, path);
      if (!space) continue;
      const spaceRoot = spaceRootPath(config, space);
      let dir = dirname(path);
      for (;;) {
        const node = nodeForPath(tree, `${dir}/index.md`) ?? tree.byPath.get(dir);
        if (node) {
          pendingNodes.add(node.id);
          break;
        }
        if (dir === spaceRoot || dir === "") break;
        dir = dirname(dir);
      }
    }

    const prompts: PromptOverrides = {};
    for (const path of files.keys()) {
      if (dirname(path) !== PROMPTS_DIR || !path.endsWith(".md")) continue;
      const name = basename(path).slice(0, -3);
      const text = this.peekText(path);
      if (isPromptName(name) && text !== undefined) prompts[name] = text;
    }

    this.derived = {
      config,
      configProblems: problems,
      files,
      tree,
      summaries,
      discussions,
      discussionsByNode,
      discussionById,
      knowledgeBySource,
      quizEvents: events,
      mastery,
      summaryStates: {
        private: owner ? summaryStates(tree, "private", summaries) : new Map(),
        public: summaryStates(tree, "public", summaries),
      },
      pendingNodes,
      prompts,
      empty: !configFile && indexPaths.length === 0,
    };
    return this.derived;
  }
}
