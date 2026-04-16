"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

import { cn } from "../lib/utils";

type ExportFormat = "svg" | "png" | "pdf" | "clipboard";

const EXPORT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
    { value: "svg", label: "Download SVG" },
    { value: "png", label: "Download PNG" },
    { value: "pdf", label: "Export PDF" },
    { value: "clipboard", label: "Copy SVG" },
];

/**
 * Downloads the rendered SVG as an SVG file.
 */
const exportSvg = (container: HTMLDivElement): void => {
    const svgEl = container.querySelector("svg");
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
};

/**
 * Rasterises the SVG to a PNG and downloads it.
 */
const exportPng = (container: HTMLDivElement): void => {
    const svgEl = container.querySelector("svg");
    if (!svgEl) return;

    // Ensure the SVG has explicit dimensions — Mermaid often omits them
    const rect = svgEl.getBoundingClientRect();
    const w = svgEl.getAttribute("width") ? svgEl.clientWidth || rect.width : rect.width;
    const h = svgEl.getAttribute("height") ? svgEl.clientHeight || rect.height : rect.height;
    if (!w || !h) return;

    // Clone so we can stamp dimensions without mutating the live element
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));

    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = 2; // retina
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
            if (!blob) return;
            const pngUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = pngUrl;
            a.download = "diagram.png";
            a.click();
            URL.revokeObjectURL(pngUrl);
        }, "image/png");
    };
    img.src = url;
};

/**
 * Opens the diagram in a new window and triggers the browser print dialog,
 * allowing the user to save it as a PDF.
 */
const exportPdf = (container: HTMLDivElement): void => {
    const svgEl = container.querySelector("svg");
    if (!svgEl) return;
    const svgHtml = svgEl.outerHTML;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Diagram</title>
<style>
  @page { margin: 1cm; }
  body { margin: 0; display: flex; justify-content: center; align-items: flex-start; }
  svg { max-width: 100%; height: auto; }
</style>
</head>
<body>${svgHtml}</body>
</html>`);
    win.document.close();
    win.addEventListener("load", () => {
        win.print();
        win.close();
    });
};

/**
 * Copies the SVG source to the clipboard.
 */
const copySvg = async (container: HTMLDivElement): Promise<void> => {
    const svgEl = container.querySelector("svg");
    if (!svgEl) return;
    await navigator.clipboard.writeText(svgEl.outerHTML);
};

// ---------------------------------------------------------------------------

/**
 * Small export dropdown — chevron pill button that opens a menu of export options.
 *
 * Receives a ref object (not a snapshot). Derefing at click time means the
 * lightbox-mounted dropdown still works, since refs attach during commit but
 * the dropdown itself is rendered in the same pass as its target container.
 */
const ExportDropdown = ({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }): JSX.Element => {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent): void => {
            const target = e.target as Node;
            const inButton = buttonRef.current?.contains(target);
            const inMenu = menuRef.current?.contains(target);
            if (!inButton && !inMenu) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const handleToggle = useCallback((): void => {
        if (!open && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            // open below the button, right-aligned
            setMenuPos({ top: rect.bottom + 4, left: rect.right });
        }
        setOpen((v) => !v);
    }, [open]);

    const handleSelect = useCallback(async (fmt: ExportFormat): Promise<void> => {
        const container = containerRef.current;
        if (!container) return;
        setOpen(false);
        if (fmt === "svg") exportSvg(container);
        else if (fmt === "png") exportPng(container);
        else if (fmt === "pdf") exportPdf(container);
        else if (fmt === "clipboard") {
            await copySvg(container);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    }, [containerRef]);

    return (
        <div onClick={(e) => e.stopPropagation()}>
            <button
                ref={buttonRef}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-(--g-text) bg-(--g-surface) border border-(--g-border) hover:bg-(--g-surface-hover) shadow-sm transition-colors select-none"
                onClick={handleToggle}
                title="Export diagram"
            >
                {copied ? "Copied!" : "Export"}
                <svg width={8} height={8} viewBox="0 0 8 8" fill="currentColor" className={`transition-transform ${open ? "rotate-180" : ""}`}>
                    <path d="M0 2.5l4 3 4-3" stroke="currentColor" strokeWidth={1.2} fill="none" strokeLinecap="round" />
                </svg>
            </button>

            {open && menuPos && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[9999] min-w-[130px] rounded-lg border border-(--g-border) bg-(--g-surface) shadow-lg py-1"
                    style={{ top: menuPos.top, left: menuPos.left, transform: "translateX(-100%)" }}
                >
                    {EXPORT_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            className="w-full text-left px-4 py-2 text-sm text-(--g-text) hover:bg-(--g-surface-hover) transition-colors"
                            onClick={() => handleSelect(opt.value)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>,
                document.body,
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------

// chars that mermaid tokenises inside unquoted labels — if any appear,
// wrap the label so it's treated as literal text
const LABEL_SPECIAL = /[{}|"<>]/;
const QUOTED_LABEL = /^\s*".*"\s*$/s;

const escapeQuotes = (s: string): string => s.replace(/"/g, "#quot;");

/**
 * Wraps mermaid node/arrow labels that contain reserved punctuation
 * (`{`, `}`, `|`, `"`, `<`, `>`) in double quotes so the parser treats
 * them as literal text. LLMs frequently emit labels like
 * `B[DELETE /sites/{id}]`, where `{` otherwise tokenises as DIAMOND_START
 * and breaks the parse.
 *
 * @param src - Raw Mermaid source
 * @returns Sanitised Mermaid source safe to pass to `mermaid.parse`
 */
const sanitizeMermaid = (src: string): string => {
    let out = src;

    // [label] — skip [[...]], [(...)], [/.../], [\...\]
    out = out.replace(
        /\b(\w+)\[(?![[(/\\])([^\]\n]*)\]/g,
        (m, id: string, label: string) => {
            if (QUOTED_LABEL.test(label)) return m;
            if (!LABEL_SPECIAL.test(label)) return m;
            return `${id}["${escapeQuotes(label)}"]`;
        },
    );

    // (label) — skip ((...))
    out = out.replace(
        /\b(\w+)\((?!\()([^)\n]*)\)/g,
        (m, id: string, label: string) => {
            if (QUOTED_LABEL.test(label)) return m;
            if (!LABEL_SPECIAL.test(label)) return m;
            return `${id}("${escapeQuotes(label)}")`;
        },
    );

    // |label| — arrow labels
    out = out.replace(
        /\|([^|\n]*)\|/g,
        (m, label: string) => {
            if (QUOTED_LABEL.test(label)) return m;
            if (!LABEL_SPECIAL.test(label)) return m;
            return `|"${escapeQuotes(label)}"|`;
        },
    );

    return out;
};

/**
 * Renders a Mermaid diagram from a code string.
 * Dynamically imports mermaid to avoid SSR issues.
 * Clicking the diagram expands it into a full-width lightbox overlay.
 * An export dropdown allows downloading the diagram as SVG or PNG.
 *
 * @param code - Raw Mermaid diagram source
 * @param isDark - Whether to use the dark theme
 */
const MermaidDiagram = ({ code, isDark }: { code: string; isDark: boolean }): JSX.Element => {
    const containerRef = useRef<HTMLDivElement>(null);
    const expandedRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const run = async (): Promise<void> => {
            try {
                const mermaid = (await import("mermaid")).default;

                mermaid.initialize({
                    startOnLoad: false,
                    theme: isDark ? "dark" : "default",
                    securityLevel: "loose",
                    fontFamily: "inherit",
                    // defense-in-depth: also stop mermaid from drawing its built-in
                    // "Syntax error in text / mermaid version X.Y.Z" fallback SVG.
                    suppressErrorRendering: true,
                });

                // sanitise before parse — LLM output often contains unquoted `{...}` path
                // params inside node labels, which mermaid tokenises as diamond shapes
                const trimmed = sanitizeMermaid(code.trim());
                // validate first — parse throws on bad syntax without touching the DOM,
                // so streaming chunks (partial fences) never reach the renderer
                await mermaid.parse(trimmed);

                // fresh random id per call — avoids conflicts if a prior svg is still in the dom
                const id = `mermaid-${Math.random().toString(36).slice(2)}`;
                const { svg } = await mermaid.render(id, trimmed);

                if (!cancelled && containerRef.current) {
                    containerRef.current.innerHTML = svg;
                    // Mirror the SVG into the expanded container if it's open
                    if (expandedRef.current) expandedRef.current.innerHTML = svg;
                    setError(null);
                    setReady(true);
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    const msg = String(err)
                        .replace(/^Error:\s*/, "")
                        .split("\n")
                        .filter((l) => !l.startsWith("mermaid version"))
                        .join("\n")
                        .trim();
                    setError(msg || "Syntax error");
                    if (containerRef.current) containerRef.current.innerHTML = "";
                    setReady(true);
                }
            }
        };

        run();
        return () => { cancelled = true; };
    }, [code, isDark]);

    // Mirror the rendered SVG into the expanded overlay whenever it opens
    useEffect(() => {
        if (expanded && expandedRef.current && containerRef.current) {
            expandedRef.current.innerHTML = containerRef.current.innerHTML;
        }
    }, [expanded]);

    return (
        <>
            {/* Inline diagram — click to expand. Kept mounted even on parse
                errors so the ref stays wired; a later code update can then
                write a valid SVG into the same container. */}
            <div
                className={cn(
                    "relative my-3 w-full overflow-x-auto rounded-lg border p-4 group",
                    error
                        ? "border-(--g-danger) bg-(--g-danger-muted)"
                        : "border-(--g-border) bg-(--g-surface) cursor-zoom-in",
                )}
                onClick={() => !error && ready && setExpanded(true)}
                title={error ? undefined : "Click to expand"}
            >
                {!ready && !error && <div className="h-16 animate-pulse rounded bg-(--g-surface-hover)" />}
                <div ref={containerRef} className={cn("flex justify-center [&_svg]:w-full [&_svg]:h-auto [&_svg]:max-h-[600px]", error && "hidden")} />
                {error && (
                    <div className="text-xs text-(--g-danger)">
                        <div className="font-semibold mb-0.5">mermaid parse error</div>
                        <pre className="whitespace-pre-wrap font-mono text-[10px] opacity-80">{error}</pre>
                    </div>
                )}
                {ready && !error && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ExportDropdown containerRef={containerRef} />
                        <span className="text-[10px] text-(--g-text-dim) select-none pointer-events-none">click to expand</span>
                    </div>
                )}
            </div>

            {/* Lightbox overlay */}
            {expanded && typeof document !== "undefined" && createPortal(
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center"
                    onClick={() => setExpanded(false)}
                >
                    {/* Dim backdrop */}
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                    {/* Diagram container — stop click propagation so clicking the diagram itself doesn't close */}
                    <div
                        className="relative z-10 w-[90vw] max-h-[90vh] overflow-auto rounded-xl border border-(--g-border) bg-(--g-surface) p-6 shadow-2xl cursor-zoom-out"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            ref={expandedRef}
                            className="flex justify-center [&_svg]:w-full [&_svg]:max-w-none [&_svg]:h-auto"
                        />
                        {/* Lightbox controls */}
                        <div className="absolute top-3 right-3 flex items-center gap-1">
                            <ExportDropdown containerRef={expandedRef} />
                            <button
                                className="flex items-center justify-center w-7 h-7 rounded-md text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors"
                                onClick={() => setExpanded(false)}
                                title="Close"
                            >
                                <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                                    <path d="M2 2l10 10M12 2L2 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
};

export default MermaidDiagram;
