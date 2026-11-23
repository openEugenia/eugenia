/** Wiki configuration: `.notes/config.yml` (§5.9). */
import { parse as parseYaml } from "yaml";
import { asNumber, asString, stringifyYaml } from "./frontmatter.ts";
import { isReservedName, isUnder, normalizePath } from "./paths.ts";
import type { Visibility } from "./types.ts";

export const CONFIG_PATH = ".notes/config.yml";
export const INDEX_JSON_PATH = ".notes/index.json";
export const PROMPTS_DIR = ".notes/prompts";

/** Parameters of the mastery algorithm (§8.3). */
export interface MasteryParams {
  /** Initial mastery of a flashcard. */
  initial: number;
  /** Coefficient of the exponential moving average. */
  alpha: number;
  /** Decay rate: β = 1 − decay_rate / (1 + t). */
  decay_rate: number;
  /** An evaluation is a success if the score is strictly greater than this threshold. */
  success_threshold: number;
  /** Threshold below which a knowledge item "may be forgotten" (review reminders). */
  reminder_threshold: number;
}

export const DEFAULT_MASTERY: Readonly<MasteryParams> = Object.freeze({
  initial: 0.5,
  alpha: 0.5,
  decay_rate: 0.05,
  success_threshold: 0.5,
  reminder_threshold: 0.4,
});

export interface WikiConfig {
  title: string;
  /** Root folder of the wiki, normalized without a trailing `/` (`""` = repository root). */
  root: string;
  /** Folder of the source library. */
  library: string;
  /** Folder of the discussions (discussions, questions, quizzes, quick notes). */
  discussions: string;
  /** Private repository declared in the public repository (`owner/name`), optional. */
  private_repo?: string;
  default_visibility: Visibility;
  folder_name_max_length: number;
  mastery: MasteryParams;
  /** Unrecognized keys, kept when writing. */
  extra: Record<string, unknown>;
}

export const DEFAULT_CONFIG: Readonly<WikiConfig> = Object.freeze({
  title: "My wiki",
  root: "wiki",
  library: "library",
  discussions: "discussions",
  default_visibility: "private",
  folder_name_max_length: 32,
  mastery: { ...DEFAULT_MASTERY },
  extra: {},
});

const KNOWN_KEYS = new Set([
  "title",
  "root",
  "library",
  "discussions",
  "private_repo",
  "default_visibility",
  "folder_name_max_length",
  "mastery",
]);

export interface ConfigResult {
  config: WikiConfig;
  problems: string[];
}

function clamp01(value: number | undefined, fallback: number): number {
  if (value === undefined || value < 0 || value > 1) return fallback;
  return value;
}

export function parseConfig(text: string | null | undefined): ConfigResult {
  const problems: string[] = [];
  let raw: Record<string, unknown> = {};
  if (text && text.trim() !== "") {
    try {
      const parsed: unknown = parseYaml(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
      } else {
        problems.push("The configuration must be a YAML mapping.");
      }
    } catch (e) {
      problems.push(`Invalid YAML configuration: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const rootValue = asString(raw.root);
  const root = rootValue === undefined ? DEFAULT_CONFIG.root : normalizePath(rootValue);
  if (root.startsWith("..")) problems.push("`root` cannot point outside the repository.");
  const space = (key: "library" | "discussions"): string => {
    const value = asString(raw[key]);
    const dir = value === undefined ? DEFAULT_CONFIG[key] : normalizePath(value);
    if (dir === "" || dir.startsWith("..") || dir.split("/").some(isReservedName)) {
      problems.push(`\`${key}\` must name a non-reserved folder of the repository.`);
      return DEFAULT_CONFIG[key];
    }
    return dir;
  };
  const library = space("library");
  const discussions = space("discussions");
  const safeRoot = root.startsWith("..") ? DEFAULT_CONFIG.root : root;
  for (const [a, b] of [
    [library, discussions],
    [safeRoot, library],
    [safeRoot, discussions],
  ] as const) {
    if (a !== "" && (isUnder(a, b) || isUnder(b, a))) {
      problems.push(`The folders "${a}" and "${b}" cannot be nested.`);
    }
  }

  const visibility = asString(raw.default_visibility);
  if (visibility !== undefined && visibility !== "public" && visibility !== "private") {
    problems.push("`default_visibility` must be `public` or `private`.");
  }

  const maxLength = asNumber(raw.folder_name_max_length);
  if (maxLength !== undefined && (maxLength < 8 || maxLength > 128)) {
    problems.push("`folder_name_max_length` must be between 8 and 128.");
  }

  const m = (raw.mastery && typeof raw.mastery === "object" ? raw.mastery : {}) as Record<
    string,
    unknown
  >;
  const mastery: MasteryParams = {
    initial: clamp01(asNumber(m.initial), DEFAULT_MASTERY.initial),
    alpha: clamp01(asNumber(m.alpha), DEFAULT_MASTERY.alpha),
    decay_rate: clamp01(asNumber(m.decay_rate), DEFAULT_MASTERY.decay_rate),
    success_threshold: clamp01(asNumber(m.success_threshold), DEFAULT_MASTERY.success_threshold),
    reminder_threshold: clamp01(asNumber(m.reminder_threshold), DEFAULT_MASTERY.reminder_threshold),
  };

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (!KNOWN_KEYS.has(key)) extra[key] = value;

  const privateRepo = asString(raw.private_repo);
  const config: WikiConfig = {
    title: asString(raw.title) ?? DEFAULT_CONFIG.title,
    root: safeRoot,
    library,
    discussions,
    default_visibility: visibility === "public" ? "public" : "private",
    folder_name_max_length:
      maxLength !== undefined && maxLength >= 8 && maxLength <= 128
        ? Math.round(maxLength)
        : DEFAULT_CONFIG.folder_name_max_length,
    mastery,
    extra,
  };
  if (privateRepo && /^[\w.-]+\/[\w.-]+$/.test(privateRepo)) config.private_repo = privateRepo;
  else if (privateRepo) problems.push("`private_repo` must have the form `owner/name`.");
  return { config, problems };
}

function rootForYaml(root: string): string {
  return root === "" ? "./" : `${root}/`;
}

export function serializeConfig(config: WikiConfig): string {
  const data: Record<string, unknown> = {
    title: config.title,
    root: rootForYaml(config.root),
    library: rootForYaml(config.library),
    discussions: rootForYaml(config.discussions),
  };
  if (config.private_repo) data.private_repo = config.private_repo;
  data.default_visibility = config.default_visibility;
  data.folder_name_max_length = config.folder_name_max_length;
  data.mastery = { ...config.mastery };
  Object.assign(data, config.extra);
  return stringifyYaml(data);
}

/**
 * Configuration copied to the public repository (§6.4): an allow-list of keys, without
 * personal settings (mastery, unknown keys).
 */
export function serializePublicConfig(config: WikiConfig, privateRepo?: string): string {
  const data: Record<string, unknown> = {
    title: config.title,
    root: rootForYaml(config.root),
    library: rootForYaml(config.library),
    discussions: rootForYaml(config.discussions),
  };
  const repo = privateRepo ?? config.private_repo;
  if (repo) data.private_repo = repo;
  data.default_visibility = config.default_visibility;
  data.folder_name_max_length = config.folder_name_max_length;
  return stringifyYaml(data);
}
