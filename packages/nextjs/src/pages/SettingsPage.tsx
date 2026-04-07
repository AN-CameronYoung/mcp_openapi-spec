"use client";
import { useState, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Ic } from "../lib/icons";
import { cn } from "../lib/utils";
import { useStore, nextJobId } from "../store/store";
import type { IngestJob } from "../store/store";
import { listApis } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";

const sectionLabel = "text-[0.9375rem] font-semibold uppercase tracking-[0.06em] text-[var(--g-text-dim)] mb-2";

type IngestMode = "url" | "file" | "paste";

// ---------------------------------------------------------------------------
// SSE ingest helper (updates store job in-place)
// ---------------------------------------------------------------------------

async function runIngestStream(
	fetchUrl: string,
	body: Record<string, unknown>,
	jobId: string,
	updateJob: (id: string, u: Partial<IngestJob>) => void,
	onDone: () => void,
) {
	updateJob(jobId, { status: "running", message: "Starting..." });
	try {
		const res = await fetch(fetchUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok || !res.body) {
			const text = await res.text();
			let msg = `HTTP ${res.status}`;
			try { msg = JSON.parse(text).error ?? msg; } catch {}
			throw new Error(msg);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				try {
					const event = JSON.parse(line.slice(6));
					if (event.phase === "complete") {
						const s = event.summary;
						updateJob(jobId, { status: "done", message: `${s.endpointsIngested} endpoints, ${s.schemasIngested} schemas`, done: undefined, total: undefined });
						onDone();
					} else if (event.phase === "error") {
						throw new Error(event.message);
					} else {
						updateJob(jobId, { status: "running", message: event.message, done: event.done, total: event.total });
					}
				} catch (e) {
					if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
				}
			}
		}
	} catch (err) {
		updateJob(jobId, { status: "error", message: err instanceof Error ? err.message : "Failed", done: undefined, total: undefined });
	}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SettingsPage() {
	const {
		apis, setApis,
		ingestJobs, addIngestJob, updateIngestJob, removeIngestJob, clearDoneJobs,
	} = useStore(useShallow((s) => ({
		apis: s.apis, setApis: s.setApis,
		ingestJobs: s.ingestJobs, addIngestJob: s.addIngestJob, updateIngestJob: s.updateIngestJob, removeIngestJob: s.removeIngestJob, clearDoneJobs: s.clearDoneJobs,
	})));

	const [mode, setMode] = useState<IngestMode>("url");
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
	const [url, setUrl] = useState("");
	const [apiName, setApiName] = useState("");
	const [pasteContent, setPasteContent] = useState("");
	const [pasteFormat, setPasteFormat] = useState<"yaml" | "json">("yaml");
	const fileRef = useRef<HTMLInputElement>(null);
	const refreshApis = async () => {
		try {
			const a = await listApis();
			setApis(a);
		} catch {}
	};

	const startIngest = (fetchUrl: string, body: Record<string, unknown>, name: string) => {
		const id = nextJobId();
		addIngestJob({ id, apiName: name, status: "queued", message: "Queued" });
		runIngestStream(fetchUrl, body, id, updateIngestJob, refreshApis);
	};

	const handleIngestUrl = () => {
		if (!url.trim() || !apiName.trim()) return;
		startIngest("/openapi/ingest", { source: url, api_name: apiName }, apiName);
		setUrl("");
		setApiName("");
	};

	const handleIngestContent = (content: string, format: "yaml" | "json", name: string) => {
		if (!content.trim() || !name.trim()) return;
		startIngest("/openapi/ingest/upload", { content, format, api_name: name }, name);
	};

	const handleFiles = async () => {
		const files = fileRef.current?.files;
		if (!files || files.length === 0) return;

		for (const file of Array.from(files)) {
			const text = await file.text();
			const fmt = file.name.endsWith(".json") ? "json" : "yaml";
			const name = file.name.replace(/\.(ya?ml|json)$/i, "");
			handleIngestContent(text, fmt, name);
		}

		// Reset file input
		if (fileRef.current) fileRef.current.value = "";
	};

	const handleSubmit = () => {
		if (mode === "url") handleIngestUrl();
		else if (mode === "file") handleFiles();
		else {
			if (!apiName.trim()) return;
			handleIngestContent(pasteContent, pasteFormat, apiName);
			setPasteContent("");
			setApiName("");
		}
	};

	const handleDelete = async (name: string) => {
		try {
			await fetch(`/openapi/apis/${encodeURIComponent(name)}`, { method: "DELETE" });
			refreshApis();
		} catch {}
	};

	const hasActiveJobs = ingestJobs.some((j) => j.status === "running" || j.status === "queued");

	return (
		<div className="px-5 py-3.5">
			<div>

				{/* ── Ingest ──────────────────────────────────── */}
				<div className="mb-6">
					<div className={sectionLabel}>Ingest API Spec</div>

					<Tabs value={mode} onValueChange={(v) => setMode(v as IngestMode)}>
						<TabsList className="mb-3.5">
							<TabsTrigger value="url">From URL</TabsTrigger>
							<TabsTrigger value="file">Upload Files</TabsTrigger>
							<TabsTrigger value="paste">Paste</TabsTrigger>
						</TabsList>

						<TabsContent value="url">
							<div className="mb-[0.6875rem]">
								<label className="text-sm text-muted-foreground block mb-1">API Name</label>
								<Input type="text" placeholder="my-api" value={apiName} onChange={(e) => setApiName(e.target.value)} />
							</div>
							<div className="mb-[0.6875rem]">
								<label className="text-sm text-muted-foreground block mb-1">Spec URL or file path</label>
								<Input
									type="text"
									placeholder="https://example.com/openapi.yaml"
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
									autoComplete="off"
								/>
							</div>
							<Button onClick={handleSubmit}>Ingest</Button>
						</TabsContent>

						<TabsContent value="file">
							<div className="mb-[0.6875rem]">
								<label className="text-sm text-muted-foreground block mb-1">
									OpenAPI spec files (YAML or JSON) — select multiple
								</label>
								<div
									onClick={() => fileRef.current?.click()}
									className="p-[1.0625rem] bg-muted border border-dashed border-border rounded-md cursor-pointer text-center text-[0.9375rem] text-muted-foreground"
								>
									Click to select files
								</div>
								<input
									ref={fileRef}
									type="file"
									accept=".yaml,.yml,.json"
									multiple
									className="hidden"
									onChange={() => handleFiles()}
								/>
							</div>
						</TabsContent>

						<TabsContent value="paste">
							<div className="mb-[0.6875rem]">
								<label className="text-sm text-muted-foreground block mb-1">API Name</label>
								<Input type="text" placeholder="my-api" value={apiName} onChange={(e) => setApiName(e.target.value)} />
							</div>
							<div className="mb-[0.6875rem]">
								<div className="flex items-center gap-2 mb-1">
									<label className="text-sm text-muted-foreground">Paste spec content</label>
									<select
										value={pasteFormat}
										onChange={(e) => setPasteFormat(e.target.value as "yaml" | "json")}
										className="text-sm px-1.5 py-px bg-muted border border-border rounded text-secondary-foreground"
									>
										<option value="yaml">YAML</option>
										<option value="json">JSON</option>
									</select>
								</div>
								<Textarea
									placeholder="openapi: '3.0.0'..."
									value={pasteContent}
									onChange={(e) => setPasteContent(e.target.value)}
									className="h-[10.5rem] py-[0.6875rem] font-mono text-[0.9375rem] resize-y"
								/>
							</div>
							<Button onClick={handleSubmit}>Ingest</Button>
						</TabsContent>
					</Tabs>
				</div>

				{/* ── Active Jobs ──────────────────────────────── */}
				{ingestJobs.length > 0 && (
					<div className="mb-6">
						<div className={cn(sectionLabel, "flex items-center")}>
							<span>Ingest Jobs</span>
							{!hasActiveJobs && ingestJobs.length > 0 && (
								<Button
									variant="ghost"
									size="xs"
									onClick={clearDoneJobs}
									className="ml-auto text-muted-foreground normal-case tracking-normal font-normal"
								>
									Clear
								</Button>
							)}
						</div>
						{ingestJobs.map((job) => (
							<div
								key={job.id}
								className="bg-muted border border-border rounded-md px-[0.6875rem] py-2 mb-1"
								style={{
									borderColor:
										job.status === "error" ? "color-mix(in srgb, var(--g-danger) 18%, transparent)" :
										job.status === "done" ? "color-mix(in srgb, var(--g-green) 18%, transparent)" :
										undefined,
								}}
							>
								<div className="flex items-center gap-2">
									<span className="text-sm font-semibold text-[var(--g-text)]">{job.apiName}</span>
									<span
										className={`text-xs px-1.5 py-px rounded font-medium${
											job.status === "running" ? " bg-[var(--g-accent-muted)] text-[var(--g-accent)]" :
											job.status === "done" ? " bg-[var(--g-green-muted)] text-[var(--g-green)]" :
											job.status === "error" ? " bg-[var(--g-danger-muted)] text-[var(--g-danger)]" :
											" bg-[var(--g-bg)] text-[var(--g-text-dim)]"
										}`}
									>
										{job.status}
									</span>
									{(job.status === "done" || job.status === "error") && (
										<Button
											variant="ghost"
											size="icon-xs"
											onClick={() => removeIngestJob(job.id)}
											className="ml-auto text-muted-foreground"
										>
											{Ic.x(13)}
										</Button>
									)}
								</div>
								<div className="text-[0.8125rem] text-[var(--g-text-dim)] mt-[0.1875rem]">{job.message}</div>
								{job.status === "running" && job.total != null && job.total > 0 && (
									<div className="h-1 bg-[var(--g-border)] rounded overflow-hidden mt-1.5">
										<div
											className="h-full bg-[var(--g-accent)] rounded"
											style={{
												width: `${Math.round(((job.done ?? 0) / job.total) * 100)}%`,
												transition: "width 0.15s",
											}}
										/>
									</div>
								)}
							</div>
						))}
					</div>
				)}

				{/* ── Ingested APIs ────────────────────────────── */}
				<div>
					<div className={sectionLabel}>Ingested APIs</div>
					{apis.length === 0 && (
						<div className="text-[0.9375rem] text-[var(--g-text-dim)]">No APIs ingested yet</div>
					)}
					{apis.map((a) => (
						<div
							key={a.name}
							className="bg-muted border border-border rounded-md flex items-center gap-[0.6875rem] px-[0.6875rem] py-[0.4375rem] mb-1"
						>
							<span className="flex text-primary opacity-50">{Ic.server()}</span>
							<span className="text-base font-medium text-foreground">{a.name}</span>
							<span className="text-sm text-muted-foreground">{a.endpoints} endpoints</span>
							<AlertDialog open={deleteTarget === a.name} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
								<AlertDialogTrigger asChild>
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={() => setDeleteTarget(a.name)}
										className="ml-auto text-muted-foreground"
									>
										{Ic.x()}
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Delete {a.name}?</AlertDialogTitle>
										<AlertDialogDescription>
											This will permanently remove all ingested endpoints and schemas for this API.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											variant="destructive"
											onClick={() => { handleDelete(a.name); setDeleteTarget(null); }}
										>
											Delete
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
