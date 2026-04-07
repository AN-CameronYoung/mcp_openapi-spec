"use client";

import { use, useCallback, useEffect, useRef } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import "./swagger-theme.css";

interface Props {
	params: Promise<{ apiName: string }>;
	searchParams: Promise<{ method?: string; path?: string; theme?: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SwaggerSystem = any;

export default function DocsPage({ params, searchParams }: Props) {
	const { apiName } = use(params);
	const { method, path, theme = "dark" } = use(searchParams);
	const systemRef = useRef<SwaggerSystem>(null);

	useEffect(() => {
		if (theme === "light") {
			document.body.classList.add("light");
		} else {
			document.body.classList.remove("light");
		}
	}, [theme]);

	function expandAndScroll(m: string, p: string) {
		const sys = systemRef.current;
		if (!sys) return;

		const mLower = m.toLowerCase();
		const pathSlug = p.replace(/[{}]/g, "_").replace(/\//g, "_");

		// Find the matching operation's tag and operationId from the DOM element IDs
		const candidates = document.querySelectorAll<HTMLElement>(`[id^="operations-"]`);
		let targetId = "";
		let targetEl: HTMLElement | null = null;
		for (const el of candidates) {
			if (el.id.includes(`-${mLower}`) && el.id.endsWith(pathSlug)) {
				targetId = el.id;
				targetEl = el;
				break;
			}
		}
		// Fallback: looser match
		if (!targetEl) {
			for (const el of candidates) {
				if (el.id.includes(`-${mLower}`) && el.id.includes(pathSlug.replace(/_+$/, ""))) {
					targetId = el.id;
					targetEl = el;
					break;
				}
			}
		}
		if (!targetId) return;

		// Parse tag and operationId from the element ID: "operations-{tag}-{operationId}"
		const withoutPrefix = targetId.replace("operations-", "");
		const firstDash = withoutPrefix.indexOf("-");
		const tag = withoutPrefix.substring(0, firstDash);
		const operationId = withoutPrefix.substring(firstDash + 1);

		// Use Swagger UI's internal layout actions to expand
		sys.layoutActions.show(["operations-tag", tag], true);
		sys.layoutActions.show(["operations", tag, operationId], true);

		// Scroll after React re-renders
		setTimeout(() => {
			targetEl?.scrollIntoView({ behavior: "smooth", block: "start" });
		}, 100);
	}

	const onComplete = useCallback(
		(system: SwaggerSystem) => {
			systemRef.current = system;
			// Expand initial endpoint from URL params
			if (method && path) {
				// Wait for Swagger UI to fully render
				setTimeout(() => expandAndScroll(method, path), 1200);
			}
		},
		[method, path],
	);

	// Listen for postMessage from parent to scroll to a different endpoint
	useEffect(() => {
		function handleMessage(event: MessageEvent) {
			if (event.data?.type === "scrollToEndpoint" && event.data.method && event.data.path) {
				expandAndScroll(event.data.method, event.data.path);
			}
		}
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	const specUrl = `/openapi/specs/${apiName}.yaml`;

	return <SwaggerUI url={specUrl} tryItOutEnabled={false} onComplete={onComplete} />;
}
