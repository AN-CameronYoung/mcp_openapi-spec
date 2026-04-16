export type DocCategory = "guide" | "reference" | "tutorial" | "changelog" | "runbook";
export type DocStatus = "draft" | "published" | "deprecated";
export type DocAudience = "developer" | "ops" | "end-user";

export interface DocMeta {
	title: string;
	author: string;
	category: DocCategory;
	tags: string[];
	project: string;
	status: DocStatus;
	audience: DocAudience;
	version?: string;
	apiRefs?: string[];
}

export interface DocIngestSummary {
	docName: string;
	project: string;
	chunksIngested: number;
}

export interface DocInfo {
	name: string;
	project: string;
	category: DocCategory;
	chunks: number;
	apiRefs: string[];
}
