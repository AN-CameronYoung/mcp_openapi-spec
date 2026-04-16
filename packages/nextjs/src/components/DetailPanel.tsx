"use client";

import { useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";

import { METHOD_COLORS } from "../lib/constants";
import { Ic } from "../lib/icons";
import { cn } from "../lib/utils";
import { useStore } from "../store/store";
import ScoreBar from "./ScoreBar";

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("json", json);

interface DetailItem {
  method?: string;
  path?: string;
  name?: string;
  api: string;
  score?: number;
  description?: string;
  full_text?: string;
  response_schema?: string;
  operation_id?: string;
  tags?: string;
  api_refs?: string[];
}

interface DetailPanelProps {
  item: DetailItem;
  type: "endpoints" | "schemas" | "docs";
  onClose: () => void;
}

interface PBadgeProps {
  type: string;
}

interface CodeBlockProps {
  lines: string[];
  nameColor: string;
}

interface CurlExampleProps {
  method: string;
  path: string;
  params: Array<{ name: string; in: string; type: string; required: boolean }>;
}

interface ResponseDropdownProps {
  content: string;
}

type ParsedParam = { name: string; in: string; type: string; required: boolean; desc: string };

/**
 * Small badge showing a parameter location (path, query, etc.).
 */
const PBadge = ({ type }: PBadgeProps): JSX.Element => {
  const isPath = type === "path";
  return (
    <span
      className={cn(
        "px-[0.4375rem] py-px rounded font-mono text-[0.6875rem] uppercase tracking-[0.05em]",
        isPath
          ? "bg-(--g-method-put-bg text-(--g-method-put-text)"
          : "bg-(--g-accent-muted) text-(--g-accent)",
      )}
    >
      {type}
    </span>
  );
};

/**
 * Renders a list of typed field names inside a code-style block.
 */
const CodeBlock = ({ lines, nameColor }: CodeBlockProps): JSX.Element => {
  return (
    <div className="overflow-x-auto rounded bg-(--g-bg) p-2 py-[0.6875rem] font-mono text-xs text-(--g-text-muted) leading-[1.7]">
      {"{"}
      <br />
      {lines.map((f, i) => {
        const colonIdx = f.indexOf(": ");
        const name = colonIdx >= 0 ? f.slice(0, colonIdx) : f;
        const type = colonIdx >= 0 ? f.slice(colonIdx) : "";
        return (
          <div key={i} className="pl-5">
            <span style={{ color: nameColor }}>{name}</span>
            <span className="text-(--g-text-dim)">{type}</span>
            {i < lines.length - 1 ? "," : ""}
          </div>
        );
      })}
      {"}"}
    </div>
  );
};

/**
 * Generates and displays a curl example for the given endpoint, with a copy button.
 */
const CurlExample = ({ method, path, params }: CurlExampleProps): JSX.Element => {
  const m = method.toUpperCase();

  // Replace path params with placeholder values
  const curlPath = path.replace(/\{([^}]+)\}/g, (_, name) => `{${name}}`);

  // Build query string from query params
  const queryParams = params.filter((p) => p.in === "query");

  let url = `https://api.example.com${curlPath}`;
  if (queryParams.length > 0) {
    const qs = queryParams.map((p) => `${p.name}={${p.name}}`).join("&");
    url += `?${qs}`;
  }

  let curl = `curl -X ${m} '${url}'`;
  curl += ` \\\n  -H 'Content-Type: application/json'`;
  curl += ` \\\n  -H 'Authorization: Bearer {token}'`;

  if (["POST", "PUT", "PATCH"].includes(m)) {
    curl += ` \\\n  -d '{}'`;
  }

  const handleCopy = () => navigator.clipboard?.writeText(curl);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="text-xs font-semibold text-(--g-text-dim) uppercase tracking-[0.06em]">
          Example
        </div>
        <button onClick={handleCopy} className="btn-icon ml-auto">
          {Ic.copy()}
        </button>
      </div>
      <SyntaxHighlighter style={oneDark} language="bash" PreTag="div" wrapLongLines customStyle={{ margin: 0, borderRadius: 4, fontSize: 11, background: "var(--g-bg)" }} codeTagProps={{ style: { background: "var(--g-bg)" } }}>
        {curl}
      </SyntaxHighlighter>
    </div>
  );
};

/**
 * Collapsible block showing the response schema with syntax highlighting.
 */
const ResponseDropdown = ({ content }: ResponseDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const isJson = content.trimStart().startsWith("{") || content.trimStart().startsWith("[");

  const handleToggle = () => setOpen(!open);

  return (
    <div className="mb-3.5">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 p-0 border-none bg-transparent cursor-pointer text-xs font-semibold text-(--g-text-dim) uppercase tracking-[0.06em]"
      >
        Response
        <span className={open ? "rotate-180 flex transition-transform duration-150" : "rotate-0 flex transition-transform duration-150"}>
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="mt-1.5">
          <SyntaxHighlighter
            style={oneDark}
            language={isJson ? "json" : "text"}
            PreTag="div"
            wrapLongLines
            customStyle={{ margin: 0, borderRadius: 4, fontSize: 11, background: "var(--g-bg)" }}
            codeTagProps={{ style: { background: "var(--g-bg)" } }}
          >
            {content}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
};

/**
 * Parse the full_text into structured sections.
 * Returns params extracted from the inline param: [...] syntax.
 */
const parseFullText = (text: string): { params: ParsedParam[]; bodyFields: string[]; responseFields: string[]; responseType: string } => {
  const params: ParsedParam[] = [];
  const bodyFields: string[] = [];
  const responseFields: string[] = [];
  let responseType = "";

  const lines = text.split("\n");
  for (const line of lines) {
    const paramMatch = line.match(/^\s*-\s*\[(\w+)\]\s+(\w+)\s+\((\w+)(?:,\s*required)?\)(?:\s*[:-]\s*(.*))?/);
    if (paramMatch) {
      params.push({
        in: paramMatch[1]!,
        name: paramMatch[2]!,
        type: paramMatch[3]!,
        required: line.includes("required"),
        desc: paramMatch[4]?.trim() ?? "",
      });
    }

    if (line.includes("Request body") || line.includes("request body")) {
      // Next lines might have fields
    }

    const fieldMatch = line.match(/^\s{2,}(\w+):\s*(.+)/);
    if (fieldMatch && !line.startsWith("  -")) {
      // Could be body or response field based on context
    }
  }

  // Simple heuristic: extract fields from response_schema
  return { params, bodyFields, responseFields, responseType };
};

/**
 * Slide-in panel showing full details for a selected endpoint or schema.
 */
const DetailPanel = ({ item, type, onClose }: DetailPanelProps): JSX.Element => {
  const viewApis = useStore((s) => s.viewApis);
  const isEp = type === "endpoints";
  const isDoc = type === "docs";
  const m = isEp ? METHOD_COLORS[item.method ?? "GET"] ?? METHOD_COLORS.GET : null;

  // Format response schema — now stored as JSON from chunker
  let responseDisplay = "";
  if (item.response_schema) {
    try {
      const parsed = JSON.parse(item.response_schema);
      responseDisplay = JSON.stringify(parsed, null, 2);
    } catch {
      responseDisplay = item.response_schema.trim();
    }
  }

  // Extract a meaningful description from full_text
  let fullDescription = item.description ?? "";
  if (item.full_text) {
    const lines = item.full_text.split("\n");
    const descLines: string[] = [];
    let pastHeader = false;
    for (const line of lines) {
      const t = line.trim();
      if (!t) { if (pastHeader) break; continue; }
      if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//.test(t)) { pastHeader = true; continue; }
      if (/^(Summary|Tags?|Parameters?|Request body|Responses?):/i.test(t)) break;
      if (/^param:\s*\[/.test(t)) break;
      if (pastHeader && t.length > 5) descLines.push(t);
    }
    if (descLines.length > 0) fullDescription = descLines.join(" ");
  }

  // Parse params from full_text
  const params: ParsedParam[] = [];
  if (item.full_text) {
    for (const line of item.full_text.split("\n")) {
      const m2 = line.match(
        /param:\s*\[(\w+)\]\s+(\S+)\s+\((\w+)(?:,\s*required)?\)/,
      );
      if (m2) {
        params.push({
          in: m2[1]!,
          name: m2[2]!,
          type: m2[3]!,
          required: line.includes("required"),
          desc: "",
        });
      }
    }
  }

  const handleViewApis = () =>
    viewApis(item.api, item.method ?? "GET", item.path ?? "", item.operation_id, item.tags?.split(",")[0]?.trim());

  const handleCopyPath = () => navigator.clipboard?.writeText(item.path ?? "");

  return (
    <div className="rounded-md border border-(--g-border-accent) bg-(--g-surface)">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-[0.6875rem] border-b border-(--g-border)">
        <span className="text-xs font-semibold text-(--g-text-dim) uppercase tracking-[0.05em]">
          {isDoc ? "Document" : isEp ? "Endpoint" : "Schema"}
        </span>
        <span className="flex-1" />
        {isEp && (
          <button
            onClick={handleViewApis}
            className="flex items-center gap-1 px-2.5 py-1 rounded border-none cursor-pointer text-xs font-medium bg-(--g-accent-muted) text-(--g-accent)"
          >
            {Ic.doc(14)} APIs {Ic.arr(13)}
          </button>
        )}
        <button onClick={onClose} className="btn-icon p-[0.1875rem]">
          {Ic.x()}
        </button>
      </div>

      {/* Body */}
      <div className="p-3.5">
        {isDoc ? (
          <>
            {/* Doc header */}
            <div className="flex items-center gap-[0.4375rem] mb-2 flex-wrap">
              <span className="flex opacity-50 text-purple-500">{Ic.doc(18)}</span>
              <span className="text-sm font-semibold text-(--g-text)">
                {item.name}
              </span>
              <span className="api-badge">
                <span className="opacity-50 flex">{Ic.tag()}</span>
                {item.api}
              </span>
              {item.score != null && <ScoreBar score={item.score} />}
            </div>

            {/* Heading path */}
            {item.path && (
              <div className="mb-2 text-xs text-(--g-text-dim)">
                {item.path}
              </div>
            )}

            {/* Linked APIs */}
            {item.api_refs && item.api_refs.length > 0 && (
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="flex opacity-50 text-(--g-text-dim)">{Ic.server(13)}</span>
                {item.api_refs.map((ref) => (
                  <span
                    key={ref}
                    onClick={() => viewApis(ref, "", "")}
                    className="text-[0.6875rem] px-1.5 py-px rounded bg-(--g-accent-muted) text-(--g-accent) font-medium cursor-pointer hover:opacity-80"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            )}

            {/* Tags */}
            {item.tags && (
              <div className="flex gap-1 mb-3 flex-wrap">
                {item.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                  <span key={t} className="text-[0.6875rem] px-1.5 py-px rounded bg-muted-foreground/10 text-muted-foreground font-medium">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Content */}
            {item.full_text && (
              <div className="max-h-[400px] overflow-auto rounded px-3.5 py-[0.6875rem] text-xs text-(--g-text-muted) leading-[1.7] whitespace-pre-wrap bg-(--g-bg)">
                {item.full_text}
              </div>
            )}
          </>
        ) : isEp ? (
          <>
            {/* Method + API + Score */}
            <div className="flex flex-wrap items-center gap-[0.4375rem] mb-2">
              <span
                className="method-badge"
                style={{ background: m!.bg, color: m!.text, border: `1px solid ${m!.border}` }}
              >
                {item.method}
              </span>
              <span className="api-badge">
                <span className="opacity-50 flex">{Ic.tag()}</span>
                {item.api}
              </span>
              {item.score != null && <ScoreBar score={item.score} />}
            </div>

            {/* Path */}
            <div className="flex items-center gap-1.5 mb-[0.6875rem] rounded px-[0.6875rem] py-[0.4375rem] bg-(--g-bg)">
              <code className="flex-1 font-mono text-xs text-(--g-text) break-all">
                {item.path}
              </code>
              <button onClick={handleCopyPath} className="btn-icon shrink-0">
                {Ic.copy()}
              </button>
            </div>

            {/* Description */}
            {fullDescription && (
              <p className="m-0 mb-3.5 text-xs text-(--g-text-muted) leading-[1.5]">
                {fullDescription}
              </p>
            )}

            {/* Parameters */}
            {params.length > 0 && (
              <div className="mb-3.5">
                <div className="mb-1.5 text-xs font-semibold text-(--g-text-dim) uppercase tracking-[0.06em]">
                  Parameters
                </div>
                {params.map((p, j) => (
                  <div
                    key={j}
                    className={cn(
                      "flex items-center gap-[0.4375rem] px-2 py-1.5 rounded text-xs",
                      j % 2 === 0 ? "bg-(--g-bg)" : "bg-transparent",
                    )}
                  >
                    <PBadge type={p.in} />
                    <code className="font-mono font-medium text-(--g-text)">{p.name}</code>
                    <span className="text-sm text-(--g-text-dim)">{p.type}</span>
                    {p.required && <span className="text-[0.6875rem] text-(--g-danger)">req</span>}
                    <span className="ml-auto text-sm text-(--g-text-dim)">{p.desc}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Response (collapsible) */}
            {responseDisplay && <ResponseDropdown content={responseDisplay} />}
          </>
        ) : (
          <>
            {/* Schema header */}
            <div className="flex items-center gap-[0.4375rem] mb-2">
              <span className="flex opacity-50 text-(--g-accent)">{Ic.cube(18)}</span>
              <span className="text-sm font-semibold font-mono text-(--g-text)">
                {item.name}
              </span>
              <span className="api-badge">
                <span className="opacity-50 flex">{Ic.tag()}</span>
                {item.api}
              </span>
              {item.score != null && <ScoreBar score={item.score} />}
            </div>

            {/* Description */}
            <p className="m-0 mb-3.5 text-xs text-(--g-text-muted) leading-[1.5]">
              {item.description}
            </p>

            {/* Full text */}
            {item.full_text && (
              <div className="max-h-[300px] overflow-auto rounded px-3.5 py-[0.6875rem] font-mono text-xs text-(--g-text-muted) leading-[1.7] whitespace-pre-wrap bg-(--g-bg)">
                {item.full_text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DetailPanel;
