"use client";

export const dynamic = "force-dynamic";

import { use, useEffect, useRef } from "react";

// swagger-ui.css is fine as a static import — only the JS bundle has ESM issues
import "swagger-ui-react/swagger-ui.css";
import "./swagger-theme.css";

// Replace microlight's output entirely with our own JSON tokenizer.
// This avoids fighting with swagger-ui.css !important rules or browser color normalization.

type HlColors = { base: string; key: string; string: string; number: string; keyword: string };

const HIGHLIGHT_COLORS: Record<string, HlColors> = {
	dark:   { base: '#E4E4E7', key: '#93C5FD', string: '#FDA58F', number: '#6EE7B7', keyword: '#C4B5FD' },
	light:  { base: '#18181B', key: '#1d4ed8', string: '#b91c1c', number: '#15803d', keyword: '#7e22ce' },
	claude: { base: '#1C1610', key: '#1e3a5f', string: '#9a3412', number: '#166534', keyword: '#6b21a8' },
};

function escHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tokenizeJson(text: string, c: HlColors): string {
	// Matches: quoted string (optionally followed by colon = key), number, keyword, or one char
	const re = /("(?:\\[\s\S]|[^"\\])*")([ \t]*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;
	let last = 0;
	let out = '';
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m.index > last) out += escHtml(text.slice(last, m.index));
		const [, str, colon, num, kw] = m;
		if (str !== undefined) {
			const color = colon !== undefined ? c.key : c.string;
			out += `<span style="color:${color} !important">${escHtml(str)}</span>`;
			if (colon !== undefined) out += escHtml(colon);
		} else if (num !== undefined) {
			out += `<span style="color:${c.number} !important">${escHtml(num)}</span>`;
		} else if (kw !== undefined) {
			out += `<span style="color:${c.keyword} !important">${escHtml(kw)}</span>`;
		}
		last = m.index + m[0]!.length;
	}
	if (last < text.length) out += escHtml(text.slice(last));
	return out;
}

// WeakSet per invocation prevents the MutationObserver from re-processing elements
// whose innerHTML we just set (which would itself trigger the observer).
function applyJsonHighlighting(container: HTMLElement, themeKey: string, processed: WeakSet<HTMLElement>): void {
	const colors = HIGHLIGHT_COLORS[themeKey] ?? HIGHLIGHT_COLORS['dark']!;
	container.querySelectorAll<HTMLElement>('.microlight').forEach((el) => {
		if (processed.has(el)) return;
		const text = el.textContent ?? '';
		if (!text.trim()) return;
		processed.add(el);
		el.innerHTML = tokenizeJson(text, colors);
	});
}

interface DocsPageProps {
	params: Promise<{ apiName: string }>;
	searchParams: Promise<{ method?: string; path?: string; theme?: string; zoom?: string }>;
}

/**
 * Renders the Swagger UI for a given API spec, optionally pre-scrolling
 * to a specific endpoint identified by method + path query params.
 *
 * Loads swagger-ui-bundle.js at runtime via a <script> tag (served from
 * /openapi/swagger-assets/bundle) to avoid Turbopack bundling the
 * @swagger-api/apidom-* ESM modules incorrectly, which causes
 * `refract is not a function` and routes hanging on a spinner.
 *
 * Accepts a `theme` query param ("light" | "dark" | "claude") to toggle the body class.
 */
const DocsPage = ({ params, searchParams }: DocsPageProps): JSX.Element => {
	const { apiName } = use(params);
	const { method, path, theme = "dark", zoom = "1" } = use(searchParams);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const uiRef = useRef<any>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		document.body.classList.remove("light", "claude");
		if (theme === "light") document.body.classList.add("light");
		else if (theme === "claude") document.body.classList.add("claude");
		document.body.style.zoom = zoom;
	}, [theme, zoom]);

	// Replace microlight output with our own syntax-highlighted HTML.
	// New WeakSet per theme ensures re-highlighting if theme changes.
	useEffect(() => {
		const themeKey = theme === "light" ? "light" : theme === "claude" ? "claude" : "dark";
		const container = containerRef.current;
		if (!container) return;
		const processed = new WeakSet<HTMLElement>();
		applyJsonHighlighting(container, themeKey, processed);
		const observer = new MutationObserver(() => applyJsonHighlighting(container, themeKey, processed));
		observer.observe(container, { childList: true, subtree: true });
		return () => observer.disconnect();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [theme]);

	/**
	 * Expands and scrolls the Swagger UI to the operation matching `m` and `p`.
	 * Returns true if the element was found and acted on, false otherwise.
	 *
	 * Uses ui.getSystem().layoutActions — SwaggerUIBundle()'s return value is a
	 * store wrapper, not the system directly; getSystem() exposes the real actions.
	 */
	const expandAndScroll = (m: string, p: string): boolean => {
		const sys = uiRef.current?.getSystem?.();
		if (!sys) return false;

		let targetEl: HTMLElement | null = null;
		const opblocks = document.querySelectorAll<HTMLElement>(".opblock");
		for (const block of opblocks) {
			const methodText = block.querySelector(".opblock-summary-method")?.textContent?.trim() ?? "";
			const pathText = block.querySelector(".opblock-summary-path, .opblock-summary-path__deprecated")?.textContent?.trim() ?? "";
			if (methodText.toUpperCase() === m.toUpperCase() && pathText === p) {
				targetEl = block;
				break;
			}
		}
		if (!targetEl?.id) return false;

		const withoutPrefix = targetEl.id.replace("operations-", "");
		const firstDash = withoutPrefix.indexOf("-");
		const tag = withoutPrefix.substring(0, firstDash);
		const operationId = withoutPrefix.substring(firstDash + 1);

		sys.layoutActions.show(["operations-tag", tag], true);
		sys.layoutActions.show(["operations", tag, operationId], true);

		const el = targetEl;
		requestAnimationFrame(() => requestAnimationFrame(() => {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
		}));
		return true;
	};

	// Listen for postMessage from parent to scroll or filter
	useEffect(() => {
		const handleMessage = (event: MessageEvent): void => {
			if (event.data?.type === "scrollToEndpoint" && event.data.method && event.data.path) {
				expandAndScroll(event.data.method, event.data.path);
			}
			if (event.data?.type === "setZoom" && typeof event.data.zoom === "number") {
				document.body.style.zoom = String(event.data.zoom);
			}
			if (event.data?.type === "searchOps") {
				const query = (event.data.query ?? "").toLowerCase().trim();
				const opblocks = document.querySelectorAll<HTMLElement>(".opblock");
				for (const block of opblocks) {
					if (!query) {
						block.style.display = "";
					} else {
						const blockPath = block.querySelector(".opblock-summary-path, .opblock-summary-path__deprecated")?.textContent ?? "";
						const desc = block.querySelector(".opblock-summary-description")?.textContent ?? "";
						const methodMatch = /\bopblock-(get|post|put|delete|patch|options|head)\b/.exec(block.className);
						const blockMethod = methodMatch?.[1] ?? "";
						const matches = blockPath.toLowerCase().includes(query) || desc.toLowerCase().includes(query) || blockMethod.includes(query);
						block.style.display = matches ? "" : "none";
					}
				}
				const tagSections = document.querySelectorAll<HTMLElement>(".opblock-tag-section");
				for (const section of tagSections) {
					const ops = section.querySelectorAll<HTMLElement>(".opblock");
					const anyVisible = !query || Array.from(ops).some((op) => op.style.display !== "none");
					section.style.display = anyVisible ? "" : "none";
				}
			}
		};
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const specUrl = `/openapi/specs/${encodeURIComponent(apiName)}.yaml`;

	// Load the pre-built swagger-ui-bundle.js at runtime (bypasses Turbopack)
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const SCRIPT_ID = "swagger-ui-bundle-script";

		const init = (): void => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const SwaggerUIBundle = (window as any).SwaggerUIBundle;
			if (typeof SwaggerUIBundle !== "function") return;

			// Capture the return value — it's a store wrapper; getSystem() gives the real system
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			uiRef.current = SwaggerUIBundle({
				url: specUrl,
				domNode: container,
				tryItOutEnabled: false,
				filter: true,
				onComplete: () => {
					if (!method || !path) return;
					const attempt = (tries: number): void => {
						if (expandAndScroll(method, path)) return;
						if (tries < 40) setTimeout(() => attempt(tries + 1), 50);
					};
					attempt(0);
				},
			});
		};

		if (document.getElementById(SCRIPT_ID)) {
			init();
			return;
		}

		const script = document.createElement("script");
		script.id = SCRIPT_ID;
		script.src = "/openapi/swagger-assets/bundle";
		script.onload = init;
		document.head.appendChild(script);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [specUrl]);

	return <div ref={containerRef} />;
};

export default DocsPage;
