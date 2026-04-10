"use client";

export const dynamic = "force-dynamic";

import { use, useEffect } from "react";

import ApiViewer from "@/components/ApiViewer";

interface DocsPageProps {
	params: Promise<{ apiName: string }>;
	searchParams: Promise<{ method?: string; path?: string; zoom?: string }>;
}

/**
 * Standalone API docs page — used when opening in a new tab.
 * Renders ApiViewer directly (no iframe, no swagger-ui-bundle).
 * Reads theme from localStorage so the page matches the app's current theme.
 */
const DocsPage = ({ params, searchParams }: DocsPageProps): JSX.Element => {
	const { apiName } = use(params);
	const { method, path, zoom = "1" } = use(searchParams);
	const anchor = method && path ? { method, path } : null;

	// Apply stored theme (same logic as store.ts applyTheme)
	useEffect(() => {
		try {
			const pref = (localStorage.getItem("greg-theme") ?? "system") as string;
			const el = document.documentElement;
			el.classList.remove("dark", "claude");
			if (pref === "claude") el.classList.add("claude");
			else if (
				pref === "dark" ||
				(pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
			) {
				el.classList.add("dark");
			}
		} catch {
			// localStorage not available (SSR guard)
		}
	}, []);

	return (
		<div style={{ height: "100vh", overflow: "hidden" }}>
			<ApiViewer
				apiName={decodeURIComponent(apiName)}
				anchor={anchor}
				zoom={parseFloat(zoom)}
			/>
		</div>
	);
};

export default DocsPage;
