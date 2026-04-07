"use client";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { listApis } from "./lib/api";
import { useStore, pageFromHash } from "./store/store";
import Header from "./components/Header";
import GregPage from "./pages/GregPage";
import SearchPage from "./pages/SearchPage";
import DocsPage from "./pages/DocsPage";
import SettingsPage from "./pages/SettingsPage";
import IngestFloat from "./components/IngestFloat";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./components/ui/sheet";

export default function App() {
	const { page, setPage, setApis, setDocsApi, docsApi, theme, setTheme, hydrateFromStorage } = useStore(
		useShallow((s) => ({ page: s.page, setPage: s.setPage, setApis: s.setApis, setDocsApi: s.setDocsApi, docsApi: s.docsApi, theme: s.theme, setTheme: s.setTheme, hydrateFromStorage: s.hydrateFromStorage }))
	);

	// Track the last non-settings page so content stays visible behind the drawer
	const lastPageRef = useRef<"greg" | "search" | "docs">("greg");
	if (page !== "settings") lastPageRef.current = page;
	const contentPage = lastPageRef.current;

	useEffect(() => {
		hydrateFromStorage();
	}, []);

	useEffect(() => {
		listApis()
			.then((apis) => {
				setApis(apis);
				if (!docsApi && apis.length > 0) {
					setDocsApi(apis[0].name);
				}
			})
			.catch(() => {});
	}, []);

	// Sync browser back/forward with page state
	useEffect(() => {
		const onPopState = () => {
			const p = pageFromHash();
			if (p) useStore.setState({ page: p });
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	// Re-apply when system preference changes
	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => setTheme("system");
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [theme]);

	const showSettings = page === "settings";

	return (
		<div className="h-screen flex flex-col">
			<Header />
			{/* Always mounted so DocsPage iframe survives tab switches */}
			<div className={contentPage === "greg" ? "contents" : "hidden"}><GregPage /></div>
			<div className={contentPage === "search" ? "contents" : "hidden"}><SearchPage /></div>
			<div className={contentPage === "docs" ? "contents" : "hidden"}><DocsPage /></div>

			{/* Settings drawer */}
			<Sheet open={showSettings} onOpenChange={(open) => { if (!open) setPage(contentPage); }}>
				<SheetContent side="right" className="w-[28rem] max-w-[90vw] p-0 flex flex-col gap-0">
					<SheetHeader className="px-5 py-3 border-b border-border shrink-0">
						<SheetTitle className="text-base font-semibold">Settings</SheetTitle>
					</SheetHeader>
					<div className="flex-1 overflow-auto">
						<SettingsPage />
					</div>
				</SheetContent>
			</Sheet>
			<IngestFloat />
		</div>
	);
}
