/** Identifier of a GitHub repository (`owner/name`). */

export interface RepoRef {
  owner: string;
  name: string;
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

/** Accepts `owner/name`, a GitHub URL or an app URL (`?repo=`). */
export function parseRepo(input: string | null | undefined): RepoRef | null {
  if (!input) return null;
  let value = input.trim();
  try {
    const url = new URL(value);
    const param = url.searchParams.get("repo");
    if (param) value = param;
    else if (url.hostname === "github.com")
      value = url.pathname.replace(/^\/+/, "").split("/").slice(0, 2).join("/");
  } catch {
    // not a URL
  }
  value = value.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
  const [owner, name, ...rest] = value.split("/");
  if (!owner || !name || rest.length > 0 || !NAME_RE.test(owner) || !NAME_RE.test(name))
    return null;
  return { owner, name };
}

export function repoKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`.toLowerCase();
}

export function repoLabel(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`;
}

export function sameRepo(a: RepoRef | null | undefined, b: RepoRef | null | undefined): boolean {
  return !!a && !!b && repoKey(a) === repoKey(b);
}
