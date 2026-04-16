"use client";

// ---------------------------------------------------------------------------
// Auth placeholder: gate this component (or redirect) based on session/role.
// The ingest API routes (/openapi/ingest, /docs/ingest) already check for
// admin role in production via getRole() in lib/auth.ts.
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { listApis, deleteApi, listDocs, deleteDoc } from "../lib/api";
import { cn } from "../lib/utils";
import { Ic } from "../lib/icons";
import { useStore, nextJobId } from "../store/store";
import type { IngestJob } from "../store/store";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";

const sectionLabel = "text-[0.9375rem] font-semibold uppercase tracking-[0.06em] text-(--g-text-dim) mb-2";

type IngestMode = "url" | "file" | "paste";
type DocIngestMode = "file" | "paste";
type AdminTab = "apis" | "docs";

// ---------------------------------------------------------------------------
// SSE ingest helper (API specs)
// ---------------------------------------------------------------------------

const runIngestStream = async (
  fetchUrl: string,
  body: Record<string, unknown>,
  jobId: string,
  updateJob: (id: string, u: Partial<IngestJob>) => void,
  onDone: () => void,
): Promise<void> => {
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
            updateJob(jobId, { status: "done", message: `${s.endpointsIngested} endpoints, ${s.schemasIngested} schemas` });
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
    updateJob(jobId, { status: "error", message: err instanceof Error ? err.message : "Failed" });
  }
};

// ---------------------------------------------------------------------------
// SSE ingest helper (Docs)
// ---------------------------------------------------------------------------

const runDocIngestStream = async (
  body: { content: string; doc_name: string },
  jobId: string,
  updateJob: (id: string, u: Partial<IngestJob>) => void,
  onDone: () => void,
): Promise<void> => {
  updateJob(jobId, { status: "running", message: "Starting..." });
  try {
    const res = await fetch("/docs/ingest", {
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
            updateJob(jobId, { status: "done", message: `${s.chunksIngested} chunks ingested` });
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
    updateJob(jobId, { status: "error", message: err instanceof Error ? err.message : "Failed" });
  }
};

// ---------------------------------------------------------------------------
// SSE ingest helper (Doc file upload — multipart to avoid JSON body limits)
// ---------------------------------------------------------------------------

const runDocUploadStream = async (
  formData: FormData,
  jobId: string,
  updateJob: (id: string, u: Partial<IngestJob>) => void,
  onDone: () => void,
): Promise<void> => {
  updateJob(jobId, { status: "running", message: "Starting..." });
  try {
    const res = await fetch("/docs/ingest/upload", {
      method: "POST",
      body: formData,
      // No Content-Type header — browser sets multipart boundary automatically
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
            updateJob(jobId, { status: "done", message: `${s.chunksIngested} chunks ingested` });
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
    updateJob(jobId, { status: "error", message: err instanceof Error ? err.message : "Failed" });
  }
};

// ---------------------------------------------------------------------------
// Meta placeholder for doc ingest textarea
// ---------------------------------------------------------------------------

const DOC_PLACEHOLDER = `# Meta
title: Authentication Guide
author: Your Name
category: guide
tags: auth,oauth
project: my-project
status: published
audience: developer

# Authentication Guide
Your content here...`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AdminPage = (): JSX.Element => {
  const {
    apis, setApis, docs, setDocs,
    ingestJobs, addIngestJob, updateIngestJob, removeIngestJob, clearDoneJobs,
  } = useStore(useShallow((s) => ({
    apis: s.apis, setApis: s.setApis,
    docs: s.docs, setDocs: s.setDocs,
    ingestJobs: s.ingestJobs, addIngestJob: s.addIngestJob, updateIngestJob: s.updateIngestJob, removeIngestJob: s.removeIngestJob, clearDoneJobs: s.clearDoneJobs,
  })));

  const [adminTab, setAdminTab] = useState<AdminTab>("apis");
  const [mode, setMode] = useState<IngestMode>("url");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [apiName, setApiName] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [pasteFormat, setPasteFormat] = useState<"yaml" | "json">("yaml");
  const fileRef = useRef<HTMLInputElement>(null);

  const [docMode, setDocMode] = useState<DocIngestMode>("file");
  const [docName, setDocName] = useState("");
  const [docContent, setDocContent] = useState("");
  const [deleteDocTarget, setDeleteDocTarget] = useState<string | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);

  const refreshApis = async (): Promise<void> => {
    try {
      const a = await listApis();
      setApis(a);
    } catch {}
  };

  const refreshDocs = async (): Promise<void> => {
    try {
      const d = await listDocs();
      setDocs(d);
    } catch {}
  };

  useEffect(() => {
    if (adminTab === "docs" && docs.length === 0) refreshDocs();
  }, [adminTab]);

  const startIngest = (fetchUrl: string, body: Record<string, unknown>, name: string): void => {
    const id = nextJobId();
    addIngestJob({ id, apiName: name, status: "queued", message: "Queued" });
    runIngestStream(fetchUrl, body, id, updateIngestJob, refreshApis);
  };

  const handleIngestUrl = (): void => {
    if (!url.trim() || !apiName.trim()) return;
    startIngest("/openapi/ingest", { source: url, api_name: apiName }, apiName);
    setUrl("");
    setApiName("");
  };

  const handleIngestContent = (content: string, format: "yaml" | "json", name: string): void => {
    if (!content.trim() || !name.trim()) return;
    startIngest("/openapi/ingest/upload", { content, format, api_name: name }, name);
  };

  const handleFiles = async (): Promise<void> => {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const text = await file.text();
      const fmt = file.name.endsWith(".json") ? "json" : "yaml";
      const name = file.name.replace(/\.(ya?ml|json)$/i, "");
      handleIngestContent(text, fmt, name);
    }

    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSubmit = (): void => {
    if (mode === "url") {
      handleIngestUrl();
    } else if (mode === "file") {
      handleFiles();
    } else {
      if (!apiName.trim()) return;
      handleIngestContent(pasteContent, pasteFormat, apiName);
      setPasteContent("");
      setApiName("");
    }
  };

  const handleDelete = async (name: string): Promise<void> => {
    try {
      await deleteApi(name);
      refreshApis();
    } catch {}
  };

  const handleDocIngest = (): void => {
    if (!docName.trim() || !docContent.trim()) return;
    const id = nextJobId();
    addIngestJob({ id, apiName: docName, status: "queued", message: "Queued" });
    runDocIngestStream({ content: docContent, doc_name: docName }, id, updateIngestJob, refreshDocs);
    setDocName("");
    setDocContent("");
  };

  const handleDocFiles = async (): Promise<void> => {
    const files = docFileRef.current?.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const name = file.name.replace(/\.mdx?$/i, "");
      const id = nextJobId();

      // Validate # Meta header without reading the whole file into a string twice
      const preview = await file.slice(0, 64).text();
      if (!preview.trimStart().startsWith("# Meta")) {
        addIngestJob({ id, apiName: name, status: "error", message: "Missing # Meta header at top of file" });
        continue;
      }

      addIngestJob({ id, apiName: name, status: "queued", message: "Queued" });

      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_name", name);
      runDocUploadStream(fd, id, updateIngestJob, refreshDocs);
    }

    if (docFileRef.current) docFileRef.current.value = "";
  };

  const handleScanDocs = (): void => {
    const id = nextJobId();
    addIngestJob({ id, apiName: "docs-scan", status: "queued", message: "Queued" });
    (async () => {
      updateIngestJob(id, { status: "running", message: "Scanning..." });
      const fileErrors: string[] = [];
      try {
        const res = await fetch("/docs/ingest/scan", { method: "POST" });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
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
                const errNote = fileErrors.length > 0
                  ? ` — ${fileErrors.length} failed: ${fileErrors.join("; ")}`
                  : "";
                updateIngestJob(id, {
                  status: fileErrors.length > 0 ? "error" : "done",
                  message: `${s.ingested} docs ingested (${s.scanned} scanned)${errNote}`,
                });
                refreshDocs();
              } else if (event.phase === "error") {
                throw new Error(event.message);
              } else if (event.phase === "file-error") {
                fileErrors.push(event.message);
                updateIngestJob(id, { status: "running", message: `Error: ${event.message}` });
              } else {
                updateIngestJob(id, { status: "running", message: event.message });
              }
            } catch (e) {
              if (e instanceof Error && e.message !== "Unexpected end of JSON input") throw e;
            }
          }
        }
      } catch (err) {
        updateIngestJob(id, { status: "error", message: err instanceof Error ? err.message : "Failed" });
      }
    })();
  };

  const handleDeleteDoc = async (name: string): Promise<void> => {
    try {
      await deleteDoc(name);
      refreshDocs();
    } catch {}
  };

  const hasActiveJobs = ingestJobs.some((j) => j.status === "running" || j.status === "queued");

  const jobsSection = ingestJobs.length > 0 && (
    <div className="mb-6">
      <div className={cn(sectionLabel, "flex items-center")}>
        <span>Ingest Jobs</span>
        {!hasActiveJobs && ingestJobs.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={clearDoneJobs}
            className="ml-auto font-normal normal-case tracking-normal text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>
      {ingestJobs.map((job) => (
        <div
          key={job.id}
          className="mb-1 rounded-md border border-border bg-muted px-[0.6875rem] py-2"
          style={{
            borderColor:
              job.status === "error" ? "color-mix(in srgb, var(--g-danger) 18%, transparent)" :
              job.status === "done" ? "color-mix(in srgb, var(--g-green) 18%, transparent)" :
              undefined,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-(--g-text)">{job.apiName}</span>
            <span
              className={`text-xs px-1.5 py-px rounded font-medium${
                job.status === "running" ? " bg-(--g-accent-muted) text-(--g-accent)" :
                job.status === "done" ? " bg-(--g-green-muted) text-(--g-green)" :
                job.status === "error" ? " bg-(--g-danger-muted) text-(--g-danger)" :
                " bg-(--g-bg) text-(--g-text-dim)"
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
          <div className="mt-[0.1875rem] text-[0.8125rem] text-(--g-text-dim)">{job.message}</div>
          {job.status === "running" && job.total != null && job.total > 0 && (
            <div className="mt-1.5 h-1 overflow-hidden rounded bg-(--g-border)">
              <div
                className="h-full rounded bg-(--g-accent)"
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
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <div className="max-w-2xl w-full mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold mb-1">Admin</h1>
        <p className="text-sm text-muted-foreground mb-6">API &amp; Documentation Ingestion</p>

        {/* APIs / Docs toggle */}
        <div className="flex gap-[0.1875rem] mb-6">
          {(
            [
              { key: "apis" as const, icon: Ic.server, label: "APIs" },
              { key: "docs" as const, icon: Ic.doc, label: "Docs" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setAdminTab(t.key)}
              className={cn(
                "flex items-center gap-1 py-1 px-[0.8125rem] rounded-md border-none cursor-pointer text-[0.9375rem] font-medium",
                adminTab === t.key
                  ? "bg-(--g-accent-muted) text-(--g-accent)"
                  : "bg-transparent text-(--g-text-dim)",
              )}
            >
              {t.icon()}
              {t.label}
            </button>
          ))}
        </div>

        {/* APIs Tab */}
        {adminTab === "apis" && (
          <>
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
                    <label className="block mb-1 text-sm text-muted-foreground">API Name</label>
                    <Input type="text" placeholder="my-api" value={apiName} onChange={(e) => setApiName(e.target.value)} />
                  </div>
                  <div className="mb-[0.6875rem]">
                    <label className="block mb-1 text-sm text-muted-foreground">Spec URL or file path</label>
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
                    <label className="block mb-1 text-sm text-muted-foreground">
                      OpenAPI spec files (YAML or JSON) — select multiple
                    </label>
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="p-[1.0625rem] rounded-md border border-dashed border-border bg-muted cursor-pointer text-center text-[0.9375rem] text-muted-foreground"
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
                    <label className="block mb-1 text-sm text-muted-foreground">API Name</label>
                    <Input type="text" placeholder="my-api" value={apiName} onChange={(e) => setApiName(e.target.value)} />
                  </div>
                  <div className="mb-[0.6875rem]">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-sm text-muted-foreground">Paste spec content</label>
                      <select
                        value={pasteFormat}
                        onChange={(e) => setPasteFormat(e.target.value as "yaml" | "json")}
                        className="px-1.5 py-px rounded border border-border bg-muted text-sm text-secondary-foreground"
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

            {jobsSection}

            <div className={sectionLabel}>Ingested APIs</div>
            {apis.length === 0 && (
              <div className="text-[0.9375rem] text-(--g-text-dim)">No APIs ingested yet</div>
            )}
            {apis.map((a) => (
              <div
                key={a.name}
                className="flex items-center justify-between gap-[0.6875rem] mb-1 rounded-md border border-border bg-muted px-[0.6875rem] py-[0.4375rem]"
              >
                <span className="flex opacity-50 text-primary">{Ic.server()}</span>
                <span className="flex-1 text-sm font-medium text-foreground">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.endpoints} endpoints</span>
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
          </>
        )}

        {/* Docs Tab */}
        {adminTab === "docs" && (
          <>
            <div className="mb-6">
              <div className={cn(sectionLabel, "flex items-center")}>
                <span>Ingest Documentation</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleScanDocs}
                  className="ml-auto font-normal normal-case tracking-normal text-muted-foreground"
                >
                  Scan docs dir
                </Button>
              </div>

              <Tabs value={docMode} onValueChange={(v) => setDocMode(v as DocIngestMode)}>
                <TabsList className="mb-3.5">
                  <TabsTrigger value="file">Upload Files</TabsTrigger>
                  <TabsTrigger value="paste">Paste</TabsTrigger>
                </TabsList>

                <TabsContent value="file">
                  <div className="mb-[0.6875rem]">
                    <label className="block mb-1 text-sm text-muted-foreground">
                      Markdown files (.md) — select multiple
                    </label>
                    <div
                      onClick={() => docFileRef.current?.click()}
                      className="p-[1.0625rem] rounded-md border border-dashed border-border bg-muted cursor-pointer text-center text-[0.9375rem] text-muted-foreground"
                    >
                      Click to select files
                    </div>
                    <input
                      ref={docFileRef}
                      type="file"
                      accept=".md,.mdx"
                      multiple
                      className="hidden"
                      onChange={() => handleDocFiles()}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="paste">
                  <div className="mb-[0.6875rem]">
                    <label className="block mb-1 text-sm text-muted-foreground">Document Name</label>
                    <Input
                      type="text"
                      placeholder="auth-guide"
                      value={docName}
                      onChange={(e) => setDocName(e.target.value)}
                    />
                  </div>
                  <div className="mb-[0.6875rem]">
                    <label className="block mb-1 text-sm text-muted-foreground">
                      Markdown content with # Meta header
                    </label>
                    <Textarea
                      placeholder={DOC_PLACEHOLDER}
                      value={docContent}
                      onChange={(e) => setDocContent(e.target.value)}
                      className="h-[14rem] py-[0.6875rem] font-mono text-[0.9375rem] resize-y"
                    />
                  </div>
                  <Button onClick={handleDocIngest}>Ingest</Button>
                </TabsContent>
              </Tabs>
            </div>

            {jobsSection}

            <div className={sectionLabel}>Ingested Docs</div>
            {docs.length === 0 && (
              <div className="text-[0.9375rem] text-(--g-text-dim)">No docs ingested yet</div>
            )}
            {docs.map((d) => (
              <div
                key={d.name}
                className="flex items-center justify-between gap-[0.6875rem] mb-1 rounded-md border border-border bg-muted px-[0.6875rem] py-[0.4375rem]"
              >
                <span className="flex opacity-50 text-primary">{Ic.doc()}</span>
                <span className="flex-1 text-sm font-medium text-foreground">{d.name}</span>
                <span className="text-xs px-1.5 py-px rounded bg-muted-foreground/10 text-muted-foreground font-medium">{d.category}</span>
                <span className="text-xs text-muted-foreground">{d.project}</span>
                <span className="text-xs text-muted-foreground">{d.chunks} chunks</span>
                <AlertDialog open={deleteDocTarget === d.name} onOpenChange={(open) => { if (!open) setDeleteDocTarget(null); }}>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setDeleteDocTarget(d.name)}
                      className="ml-auto text-muted-foreground"
                    >
                      {Ic.x()}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {d.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove all ingested chunks for this document.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => { handleDeleteDoc(d.name); setDeleteDocTarget(null); }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminPage;
