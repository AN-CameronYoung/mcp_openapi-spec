"use client";

import { use, useCallback, useEffect, useRef } from "react";

import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

import "./swagger-theme.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SwaggerSystem = any;

interface DocsPageProps {
	params: Promise<{ apiName: string }>;
	searchParams: Promise<{ method?: string; path?: string; theme?: string }>;
}

/**
 * Renders the Swagger UI for a given API spec, optionally pre-scrolling
 * to a specific endpoint identified by method + path query params.
 *
 * Accepts a `theme` query param ("light" | "dark") to toggle the body class.
 */
const DocsPage = ({ params, searchParams }: DocsPageProps): JSX.Element => {
	const { apiName } = use(params);
	const { method, path, theme = "dark" } = use(searchParams);
	const systemRef = useRef<SwaggerSystem>(null);

	useEffect(() => {
		document.body.classList.remove("light", "claude");
		if (theme === "light") document.body.classList.add("light");
		else if (theme === "claude") document.body.classList.add("claude");
	}, [theme]);

	/**
	 * Expands and scrolls the Swagger UI to the operation matching `m` and `p`.
	 * Returns true if the element was found and scrolled to, false otherwise.
	 *
	 * @param m - HTTP method (e.g. "GET")
	 * @param p - URL path (e.g. "/users/{id}")
	 */
	const expandAndScroll = (m: string, p: string): boolean => {
		const sys = systemRef.current;
		if (!sys) return false;

		// Match by rendered text — ID-based matching is unreliable because specs use
		// arbitrary operationId values that don't derive from the path.
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

		// Parse tag and operationId from the element ID: "operations-{tag}-{operationId}"
		const withoutPrefix = targetEl.id.replace("operations-", "");
		const firstDash = withoutPrefix.indexOf("-");
		const tag = withoutPrefix.substring(0, firstDash);
		const operationId = withoutPrefix.substring(firstDash + 1);

		// Use Swagger UI's internal layout actions to expand
		sys.layoutActions.show(["operations-tag", tag], true);
		sys.layoutActions.show(["operations", tag, operationId], true);

		// Scroll after React re-renders the expanded block
		const el = targetEl;
		requestAnimationFrame(() => requestAnimationFrame(() => {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
		}));
		return true;
	};

	const onComplete = useCallback(
		(system: SwaggerSystem) => {
			systemRef.current = system;
			if (!method || !path) return;
			// Poll until Swagger UI has rendered the opblocks, then scroll immediately.
			// Much faster than a fixed timeout — usually resolves in 1-2 ticks.
			const attempt = (tries: number): void => {
				if (expandAndScroll(method, path)) return;
				if (tries < 40) setTimeout(() => attempt(tries + 1), 50);
			};
			attempt(0);
		},
		[method, path],
	);

	// Listen for postMessage from parent to scroll to a different endpoint or filter by search
	useEffect(() => {
		const handleMessage = (event: MessageEvent): void => {
			if (event.data?.type === "scrollToEndpoint" && event.data.method && event.data.path) {
				expandAndScroll(event.data.method, event.data.path);
			}
			if (event.data?.type === "searchOps") {
				const query = (event.data.query ?? "").toLowerCase().trim();
				const opblocks = document.querySelectorAll<HTMLElement>(".opblock");
				for (const block of opblocks) {
					if (!query) {
						block.style.display = "";
					} else {
						const path = block.querySelector(".opblock-summary-path, .opblock-summary-path__deprecated")?.textContent ?? "";
						const desc = block.querySelector(".opblock-summary-description")?.textContent ?? "";
						const methodMatch = /\bopblock-(get|post|put|delete|patch|options|head)\b/.exec(block.className);
						const method = methodMatch?.[1] ?? "";
						const matches = path.toLowerCase().includes(query) || desc.toLowerCase().includes(query) || method.includes(query);
						block.style.display = matches ? "" : "none";
					}
				}
				// Hide tag sections where every operation is hidden
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
	}, []);

	const specUrl = `/openapi/specs/${apiName}.yaml`;

	return <SwaggerUI url={specUrl} tryItOutEnabled={false} onComplete={onComplete} />;
};

export default DocsPage;
