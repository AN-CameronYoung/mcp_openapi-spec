"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

/** Convert heading text to a URL-friendly id (matches GitHub's algorithm). */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-");

/** Extract plain text from React children for use in heading ids. */
const childrenToText = (children: React.ReactNode): string => {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (children && typeof children === "object" && "props" in (children as object)) {
    return childrenToText((children as React.ReactElement).props.children);
  }
  return "";
};

const handleAnchorClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
  if (!href.startsWith("#")) return;
  e.preventDefault();
  const id = href.slice(1);
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

const components = {
  h1({ children }: { children?: React.ReactNode }) {
    const id = slugify(childrenToText(children));
    return <h1 id={id} className="text-2xl font-bold text-(--g-text) mt-6 mb-3 first:mt-0">{children}</h1>;
  },
  h2({ children }: { children?: React.ReactNode }) {
    const id = slugify(childrenToText(children));
    return <h2 id={id} className="text-xl font-semibold text-(--g-text) mt-5 mb-2 border-b border-(--g-border) pb-1">{children}</h2>;
  },
  h3({ children }: { children?: React.ReactNode }) {
    const id = slugify(childrenToText(children));
    return <h3 id={id} className="text-lg font-semibold text-(--g-text) mt-4 mb-1.5">{children}</h3>;
  },
  h4({ children }: { children?: React.ReactNode }) {
    const id = slugify(childrenToText(children));
    return <h4 id={id} className="text-base font-semibold text-(--g-text) mt-3 mb-1">{children}</h4>;
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p className="my-2 leading-relaxed">{children}</p>;
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul className="my-2 pl-5 list-disc">{children}</ul>;
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol className="my-2 pl-5 list-decimal">{children}</ol>;
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li className="my-0.5">{children}</li>;
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    const h = String(href ?? "");
    const isFragment = h.startsWith("#");
    return (
      <a
        href={h}
        className="text-(--g-accent) underline"
        onClick={isFragment ? (e) => handleAnchorClick(e, h) : undefined}
        {...(!isFragment && { target: "_blank", rel: "noopener noreferrer" })}
      >
        {children}
      </a>
    );
  },
  code({ className, children }: { className?: string; children?: React.ReactNode }) {
    const isBlock = /language-/.test(String(className ?? "")) || String(children ?? "").includes("\n");
    if (isBlock) {
      return (
        <pre className="overflow-x-auto rounded-md bg-(--g-code-bg) p-3 my-2 text-xs leading-relaxed border border-(--g-border)">
          <code>{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-(--g-code-bg) py-px px-1 font-mono text-[0.9em]" style={{ color: "var(--g-inline-code-text)" }}>
        {children}
      </code>
    );
  },
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
  blockquote({ children }: { children?: React.ReactNode }) {
    return <blockquote className="border-l-2 border-(--g-accent) pl-3 my-2 text-(--g-text-dim) italic">{children}</blockquote>;
  },
  hr() {
    return <hr className="my-4 border-(--g-border)" />;
  },
  table({ children }: { children?: React.ReactNode }) {
    return <div className="overflow-x-auto my-2"><table className="border-collapse min-w-full text-sm">{children}</table></div>;
  },
  thead({ children }: { children?: React.ReactNode }) {
    return <thead className="border-b border-(--g-border)">{children}</thead>;
  },
  th({ children }: { children?: React.ReactNode }) {
    return <th className="py-1 px-2 text-left font-semibold text-(--g-text)">{children}</th>;
  },
  td({ children }: { children?: React.ReactNode }) {
    return <td className="py-1 px-2 border-t border-(--g-border) text-(--g-text-muted)">{children}</td>;
  },
  img({ src, alt }: { src?: string; alt?: string }) {
    return <img src={String(src)} alt={String(alt ?? "")} className="block max-w-full max-h-80 rounded-lg mt-2" />;
  },
  strong({ children }: { children?: React.ReactNode }) {
    return <strong className="font-semibold text-(--g-text)">{children}</strong>;
  },
};

const MarkdownContent = ({ content, className, style }: MarkdownContentProps): JSX.Element => (
  <div className={className ?? "text-sm text-(--g-text-muted) leading-relaxed"} style={style}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
      {content}
    </ReactMarkdown>
  </div>
);

export default MarkdownContent;
