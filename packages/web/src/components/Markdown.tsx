/**
 * Sanitized Markdown rendering (no raw HTML, §12): internal links resolved to the pages of the
 * wiki, `eugenia:ID` links produced by Eugenia, images and attached files of the repository.
 */
import { memo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isExternalUrl, linkedNode, resolveLinkTarget } from "@openeugenia/core";
import { EUGENIA_LINK_PREFIX } from "@openeugenia/ai/constants";
import { openAttachment, useBinaryUrl } from "../lib/hooks.ts";
import { href } from "../lib/router.ts";
import { useWiki } from "../store/wiki.ts";
import { toast } from "../store/ui.ts";

interface MarkdownProps {
  text: string;
  /** File the text comes from, to resolve relative links. */
  path: string;
  className?: string;
}

function urlTransform(url: string): string {
  return url.startsWith(EUGENIA_LINK_PREFIX) ? url : defaultUrlTransform(url);
}

function RepoImage({ path, alt }: { path: string; alt: string }) {
  const { data, error } = useBinaryUrl(path);
  if (error) return <span className="muted">[image indisponible : {alt || path}]</span>;
  if (!data) return <span className="muted">[{alt || "image"}…]</span>;
  return <img src={data} alt={alt} loading="lazy" />;
}

function WikiLink({ url, path, children }: { url: string; path: string; children: ReactNode }) {
  const tree = useWiki((s) => s.derived?.tree);
  if (url.startsWith(EUGENIA_LINK_PREFIX)) {
    const id = url.slice(EUGENIA_LINK_PREFIX.length);
    const node = tree?.nodes.get(id);
    return node ? (
      <a href={href({ name: "node", id })} title={node.title}>
        {children}
      </a>
    ) : (
      <span className="broken" title="Page not found">
        {children}
      </span>
    );
  }
  if (isExternalUrl(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  if (url.startsWith("#")) return <span>{children}</span>;
  const target = resolveLinkTarget(path, url);
  const node = target && tree ? linkedNode(tree, target) : undefined;
  if (node) return <a href={href({ name: "node", id: node.id })}>{children}</a>;
  if (target && useWiki.getState().derived?.files.has(target.path)) {
    return (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          openAttachment(target.path).catch((error: unknown) => toast(String(error), "error"));
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <a className="broken" title="Broken link">
      {children}
    </a>
  );
}

function MarkdownImpl({ text, path, className = "prose" }: MarkdownProps) {
  const components: Components = {
    a: ({ href: url, children }) => (
      <WikiLink url={url ?? ""} path={path}>
        {children}
      </WikiLink>
    ),
    img: ({ src, alt }) => {
      const source = typeof src === "string" ? src : "";
      if (!source || isExternalUrl(source))
        return source ? <img src={source} alt={alt ?? ""} loading="lazy" /> : null;
      const target = resolveLinkTarget(path, source);
      return target ? <RepoImage path={target.path} alt={alt ?? ""} /> : null;
    },
  };
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={urlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
