#!/usr/bin/env bun

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Command } from "commander";
import YAML from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProxyConfig {
	apis: Record<string, {
		authorization: {
			headers: Record<string, string>;
		};
	}>;
}

interface DiscoveryContext {
	node: string;
	vmid: string;
	lxcid: string;
	storage: string;
	iface: string;
	service: string;
	upid: string;
	snapname: string;
	lxcSnapname: string;
	backupId: string;
	replicationId: string;
	haResource: string;
	haGroup: string;
	firewallRulePos: string;
	firewallGroupName: string;
	firewallIPSetName: string;
	firewallAliasName: string;
	sdnVnet: string;
	sdnZone: string;
	sdnController: string;
	acmePlugin: string;
	metricsServer: string;
	userid: string;
	realm: string;
	roleid: string;
	groupid: string;
	poolid: string;
	volume: string;
	vmFirewallRulePos: string;
	tokenid: string;
}

interface Observation {
	path: string;
	operationId: string;
	tags: string[];
	parameters: ObservationParam[];
	schema: JsonSchema | null;
}

interface ObservationParam {
	name: string;
	in: string;
	type: string;
}

interface JsonSchema {
	type?: string;
	nullable?: boolean;
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema;
}

type EndpointDef = [string, string, string, [string, string, string, string][]];

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

function loadEnvValues(filePath: string): Record<string, string> {
	const text = Bun.env.NODE_ENV === "test" ? "" : require("fs").readFileSync(filePath, "utf-8") as string;
	const result: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let value = trimmed.slice(eqIdx + 1).trim();
		if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

function decryptToken(encryptedBase64: string, hexKey: string): string {
	const keyBytes = Buffer.from(hexKey, "hex");
	const cipherBlob = Buffer.from(encryptedBase64, "base64");
	const iv = cipherBlob.subarray(0, 12);
	const authTag = cipherBlob.subarray(cipherBlob.length - 16);
	const ciphertext = cipherBlob.subarray(12, cipherBlob.length - 16);
	const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes, iv);
	decipher.setAuthTag(authTag);
	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return decrypted.toString("utf-8");
}

function loadAuth(): string {
	const proxyDir = path.resolve("..", "mcp_generic-api-passthrough");
	const envPath = path.join(proxyDir, ".env");
	const configPath = path.join(proxyDir, "config.yaml");

	const envVars = loadEnvValues(envPath);
	const encryptionKey = envVars["ENCRYPTION_KEY"];
	if (!encryptionKey) {
		throw new Error("ENCRYPTION_KEY not found in " + envPath);
	}

	const configText = require("fs").readFileSync(configPath, "utf-8") as string;
	const config = YAML.parse(configText) as ProxyConfig;

	const proxmoxApi = config.apis["/proxmox"];
	if (!proxmoxApi) {
		throw new Error("No /proxmox entry in config.yaml apis");
	}

	const encryptedValue = proxmoxApi.authorization.headers["Authorization"];
	if (!encryptedValue) {
		throw new Error("No Authorization header found in proxmox config");
	}

	return decryptToken(encryptedValue, encryptionKey);
}

// ---------------------------------------------------------------------------
// HTTP Client
// ---------------------------------------------------------------------------

const BASE_URL = "https://gate.home.itsnotcam.dev";

interface FetchClient {
	get(url: string): Promise<{ data: unknown }>;
}

function createClient(authToken: string, skipSsl: boolean): FetchClient {
	return {
		async get(url: string) {
			const fullUrl = `${BASE_URL}${url}`;
			const resp = await fetch(fullUrl, {
				headers: { "Authorization": authToken },
				signal: AbortSignal.timeout(30000),
				...(skipSsl ? { tls: { rejectUnauthorized: false } } : {}),
			});
			if (!resp.ok) {
				throw new FetchError(resp.status, resp.statusText);
			}
			const data = await resp.json();
			return { data };
		},
	};
}

class FetchError extends Error {
	status: number;
	constructor(status: number, statusText: string) {
		super(`HTTP ${status} ${statusText}`);
		this.status = status;
	}
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function safeGet(client: FetchClient, url: string): Promise<Record<string, unknown> | null> {
	try {
		const resp = await client.get(url);
		return resp.data as Record<string, unknown>;
	} catch {
		return null;
	}
}

function extractDataArray(resp: Record<string, unknown> | null): Record<string, unknown>[] {
	if (!resp) return [];
	const data = resp["data"];
	if (Array.isArray(data)) return data as Record<string, unknown>[];
	return [];
}

function firstField(items: Record<string, unknown>[], field: string): string {
	if (items.length === 0) return "";
	const val = items[0][field];
	return val !== undefined && val !== null ? String(val) : "";
}

async function discover(client: FetchClient): Promise<DiscoveryContext> {
	const ctx: DiscoveryContext = {
		node: "",
		vmid: "",
		lxcid: "",
		storage: "",
		iface: "",
		service: "",
		upid: "",
		snapname: "",
		lxcSnapname: "",
		backupId: "",
		replicationId: "",
		haResource: "",
		haGroup: "",
		firewallRulePos: "0",
		firewallGroupName: "",
		firewallIPSetName: "",
		firewallAliasName: "",
		sdnVnet: "",
		sdnZone: "",
		sdnController: "",
		acmePlugin: "",
		metricsServer: "",
		userid: "",
		realm: "",
		roleid: "",
		groupid: "",
		poolid: "",
		volume: "",
		vmFirewallRulePos: "0",
		tokenid: "",
	};

	// Discover node
	console.log("[discover] Fetching nodes...");
	const nodesResp = await safeGet(client, "/api2/json/nodes");
	const nodes = extractDataArray(nodesResp);
	ctx.node = firstField(nodes, "node");
	if (!ctx.node) {
		console.error("[discover] No nodes found — cannot proceed");
		return ctx;
	}
	console.log(`[discover] node = ${ctx.node}`);

	// Parallel discovery from node-level endpoints
	const nodeBase = `/api2/json/nodes/${ctx.node}`;

	const [
		qemuResp,
		lxcResp,
		storageResp,
		networkResp,
		servicesResp,
		tasksResp,
	] = await Promise.all([
		safeGet(client, `${nodeBase}/qemu`),
		safeGet(client, `${nodeBase}/lxc`),
		safeGet(client, `${nodeBase}/storage`),
		safeGet(client, `${nodeBase}/network`),
		safeGet(client, `${nodeBase}/services`),
		safeGet(client, `${nodeBase}/tasks`),
	]);

	const qemuItems = extractDataArray(qemuResp);
	ctx.vmid = firstField(qemuItems, "vmid");
	console.log(`[discover] vmid = ${ctx.vmid}`);

	const lxcItems = extractDataArray(lxcResp);
	ctx.lxcid = firstField(lxcItems, "vmid");
	console.log(`[discover] lxcid = ${ctx.lxcid}`);

	const storageItems = extractDataArray(storageResp);
	ctx.storage = firstField(storageItems, "storage");
	console.log(`[discover] storage = ${ctx.storage}`);

	const networkItems = extractDataArray(networkResp);
	ctx.iface = firstField(networkItems, "iface");
	console.log(`[discover] iface = ${ctx.iface}`);

	const serviceItems = extractDataArray(servicesResp);
	ctx.service = firstField(serviceItems, "service");
	console.log(`[discover] service = ${ctx.service}`);

	const taskItems = extractDataArray(tasksResp);
	ctx.upid = firstField(taskItems, "upid");
	console.log(`[discover] upid = ${ctx.upid ? ctx.upid.slice(0, 40) + "..." : ""}`);

	// Discover snapshots if VM found
	if (ctx.vmid) {
		const snapResp = await safeGet(client, `${nodeBase}/qemu/${ctx.vmid}/snapshot`);
		const snaps = extractDataArray(snapResp);
		const nonCurrent = snaps.filter((s) => s["name"] !== "current");
		ctx.snapname = firstField(nonCurrent.length > 0 ? nonCurrent : snaps, "name");
		console.log(`[discover] snapname = ${ctx.snapname}`);

		// VM firewall rules
		const vmFwResp = await safeGet(client, `${nodeBase}/qemu/${ctx.vmid}/firewall/rules`);
		const vmFwRules = extractDataArray(vmFwResp);
		ctx.vmFirewallRulePos = firstField(vmFwRules, "pos") || "0";
	}

	// Discover LXC snapshots
	if (ctx.lxcid) {
		const lxcSnapResp = await safeGet(client, `${nodeBase}/lxc/${ctx.lxcid}/snapshot`);
		const lxcSnaps = extractDataArray(lxcSnapResp);
		const nonCurrent = lxcSnaps.filter((s) => s["name"] !== "current");
		ctx.lxcSnapname = firstField(nonCurrent.length > 0 ? nonCurrent : lxcSnaps, "name");
		console.log(`[discover] lxcSnapname = ${ctx.lxcSnapname}`);
	}

	// Discover storage content (volumes)
	if (ctx.storage) {
		const contentResp = await safeGet(client, `${nodeBase}/storage/${ctx.storage}/content`);
		const contentItems = extractDataArray(contentResp);
		ctx.volume = firstField(contentItems, "volid");
		console.log(`[discover] volume = ${ctx.volume}`);
	}

	// Cluster-level discovery
	const [
		backupResp,
		replicationResp,
		haResourcesResp,
		haGroupsResp,
		fwRulesResp,
		fwGroupsResp,
		fwIPSetsResp,
		fwAliasesResp,
		sdnVnetsResp,
		sdnZonesResp,
		sdnControllersResp,
		acmePluginsResp,
		metricsResp,
		usersResp,
		domainsResp,
		rolesResp,
		groupsResp,
		poolsResp,
	] = await Promise.all([
		safeGet(client, "/api2/json/cluster/backup"),
		safeGet(client, "/api2/json/cluster/replication"),
		safeGet(client, "/api2/json/cluster/ha/resources"),
		safeGet(client, "/api2/json/cluster/ha/groups"),
		safeGet(client, "/api2/json/cluster/firewall/rules"),
		safeGet(client, "/api2/json/cluster/firewall/groups"),
		safeGet(client, "/api2/json/cluster/firewall/ipset"),
		safeGet(client, "/api2/json/cluster/firewall/aliases"),
		safeGet(client, "/api2/json/cluster/sdn/vnets"),
		safeGet(client, "/api2/json/cluster/sdn/zones"),
		safeGet(client, "/api2/json/cluster/sdn/controllers"),
		safeGet(client, "/api2/json/cluster/acme/plugins"),
		safeGet(client, "/api2/json/cluster/metrics/server"),
		safeGet(client, "/api2/json/access/users"),
		safeGet(client, "/api2/json/access/domains"),
		safeGet(client, "/api2/json/access/roles"),
		safeGet(client, "/api2/json/access/groups"),
		safeGet(client, "/api2/json/pools"),
	]);

	ctx.backupId = firstField(extractDataArray(backupResp), "id");
	ctx.replicationId = firstField(extractDataArray(replicationResp), "id");
	ctx.haResource = firstField(extractDataArray(haResourcesResp), "sid");
	ctx.haGroup = firstField(extractDataArray(haGroupsResp), "group");
	ctx.firewallRulePos = firstField(extractDataArray(fwRulesResp), "pos") || "0";
	ctx.firewallGroupName = firstField(extractDataArray(fwGroupsResp), "group");
	ctx.firewallIPSetName = firstField(extractDataArray(fwIPSetsResp), "name");
	ctx.firewallAliasName = firstField(extractDataArray(fwAliasesResp), "name");
	ctx.sdnVnet = firstField(extractDataArray(sdnVnetsResp), "vnet");
	ctx.sdnZone = firstField(extractDataArray(sdnZonesResp), "zone");
	ctx.sdnController = firstField(extractDataArray(sdnControllersResp), "controller");
	ctx.acmePlugin = firstField(extractDataArray(acmePluginsResp), "plugin");
	ctx.metricsServer = firstField(extractDataArray(metricsResp), "id");
	ctx.userid = firstField(extractDataArray(usersResp), "userid");
	ctx.realm = firstField(extractDataArray(domainsResp), "realm");
	ctx.roleid = firstField(extractDataArray(rolesResp), "roleid");
	ctx.groupid = firstField(extractDataArray(groupsResp), "groupid");
	ctx.poolid = firstField(extractDataArray(poolsResp), "poolid");

	// User tokens
	if (ctx.userid) {
		const tokenResp = await safeGet(client, `/api2/json/access/users/${encodeURIComponent(ctx.userid)}/token`);
		const tokenItems = extractDataArray(tokenResp);
		ctx.tokenid = firstField(tokenItems, "tokenid");
		console.log(`[discover] tokenid = ${ctx.tokenid}`);
	}

	console.log("[discover] Discovery complete");
	return ctx;
}

// ---------------------------------------------------------------------------
// Schema Inference
// ---------------------------------------------------------------------------

function inferSchema(value: unknown, depth: number = 0): JsonSchema {
	if (depth > 3) {
		return { type: "object" };
	}
	if (value === null || value === undefined) {
		return { type: "string", nullable: true };
	}
	if (typeof value === "boolean") {
		return { type: "boolean" };
	}
	if (typeof value === "number") {
		return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
	}
	if (typeof value === "string") {
		return { type: "string" };
	}
	if (Array.isArray(value)) {
		if (value.length === 0) {
			return { type: "array", items: {} };
		}
		// Merge keys from first 5 items
		const sample = value.slice(0, 5);
		const allKeys = new Set<string>();
		for (const item of sample) {
			if (item !== null && typeof item === "object" && !Array.isArray(item)) {
				for (const key of Object.keys(item as Record<string, unknown>)) {
					allKeys.add(key);
				}
			}
		}
		if (allKeys.size > 0) {
			const merged: Record<string, unknown> = {};
			for (const key of allKeys) {
				// Find first non-null value for this key across sample items
				let foundValue: unknown = undefined;
				for (const item of sample) {
					if (item !== null && typeof item === "object" && !Array.isArray(item)) {
						const obj = item as Record<string, unknown>;
						if (obj[key] !== undefined && obj[key] !== null) {
							foundValue = obj[key];
							break;
						}
					}
				}
				merged[key] = foundValue !== undefined ? foundValue : null;
			}
			return { type: "array", items: inferSchema(merged, depth + 1) };
		}
		return { type: "array", items: inferSchema(value[0], depth + 1) };
	}
	if (typeof value === "object") {
		const props: Record<string, JsonSchema> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			props[k] = inferSchema(v, depth + 1);
		}
		return { type: "object", properties: props };
	}
	return { type: "string" };
}

// ---------------------------------------------------------------------------
// Endpoint Catalog
// ---------------------------------------------------------------------------

const ENDPOINTS: EndpointDef[] = [
	// ---- version ----
	["/api2/json/version", "getVersion", "version", []],

	// ---- cluster ----
	["/api2/json/cluster", "getCluster", "cluster", []],
	["/api2/json/cluster/status", "getClusterStatus", "cluster", []],
	["/api2/json/cluster/log", "getClusterLog", "cluster", []],
	["/api2/json/cluster/options", "getClusterOptions", "cluster", []],
	["/api2/json/cluster/tasks", "getClusterTasks", "cluster", []],
	["/api2/json/cluster/resources", "getClusterResources", "cluster", []],

	// ---- cluster/config ----
	["/api2/json/cluster/config", "getClusterConfig", "cluster", []],
	["/api2/json/cluster/config/apiversion", "getClusterConfigApiversion", "cluster", []],
	["/api2/json/cluster/config/nodes", "getClusterConfigNodes", "cluster", []],
	["/api2/json/cluster/config/join", "getClusterConfigJoin", "cluster", []],
	["/api2/json/cluster/config/qdevice", "getClusterConfigQdevice", "cluster", []],
	["/api2/json/cluster/config/totem", "getClusterConfigTotem", "cluster", []],

	// ---- cluster/backup ----
	["/api2/json/cluster/backup", "getClusterBackup", "cluster", []],
	["/api2/json/cluster/backup/{id}", "getClusterBackupSingle", "cluster", [
		["id", "path", "string", "backupId"],
	]],
	["/api2/json/cluster/backup/{id}/included_volumes", "getClusterBackupSingleIncludedvolumes", "cluster", [
		["id", "path", "string", "backupId"],
	]],
	["/api2/json/cluster/backupinfo", "getClusterBackupinfo", "cluster", []],
	["/api2/json/cluster/backupinfo/not_backed_up", "getClusterBackupinfoNotbackedup", "cluster", []],

	// ---- cluster/replication ----
	["/api2/json/cluster/replication", "getClusterReplication", "cluster", []],
	["/api2/json/cluster/replication/{id}", "getClusterReplicationSingle", "cluster", [
		["id", "path", "string", "replicationId"],
	]],

	// ---- cluster/ha ----
	["/api2/json/cluster/ha", "getClusterHa", "cluster", []],
	["/api2/json/cluster/ha/status", "getClusterHaStatus", "cluster", []],
	["/api2/json/cluster/ha/status/current", "getClusterHaStatusCurrent", "cluster", []],
	["/api2/json/cluster/ha/status/manager_status", "getClusterHaStatusManagerstatus", "cluster", []],
	["/api2/json/cluster/ha/resources", "getClusterHaResources", "cluster", []],
	["/api2/json/cluster/ha/resources/{sid}", "getClusterHaResourcesSingle", "cluster", [
		["sid", "path", "string", "haResource"],
	]],
	["/api2/json/cluster/ha/groups", "getClusterHaGroups", "cluster", []],
	["/api2/json/cluster/ha/groups/{group}", "getClusterHaGroupsSingle", "cluster", [
		["group", "path", "string", "haGroup"],
	]],

	// ---- cluster/firewall ----
	["/api2/json/cluster/firewall", "getClusterFirewall", "cluster", []],
	["/api2/json/cluster/firewall/options", "getClusterFirewallOptions", "cluster", []],
	["/api2/json/cluster/firewall/rules", "getClusterFirewallRules", "cluster", []],
	["/api2/json/cluster/firewall/rules/{pos}", "getClusterFirewallRule", "cluster", [
		["pos", "path", "integer", "firewallRulePos"],
	]],
	["/api2/json/cluster/firewall/aliases", "getClusterFirewallAliases", "cluster", []],
	["/api2/json/cluster/firewall/aliases/{name}", "getClusterFirewallAlias", "cluster", [
		["name", "path", "string", "firewallAliasName"],
	]],
	["/api2/json/cluster/firewall/macros", "getClusterFirewallMacros", "cluster", []],
	["/api2/json/cluster/firewall/refs", "getClusterFirewallRefs", "cluster", []],
	["/api2/json/cluster/firewall/groups", "getClusterFirewallGroups", "cluster", []],
	["/api2/json/cluster/firewall/groups/{group}", "getClusterFirewallGroupRules", "cluster", [
		["group", "path", "string", "firewallGroupName"],
	]],
	["/api2/json/cluster/firewall/groups/{group}/{pos}", "getClusterFirewallGroupRule", "cluster", [
		["group", "path", "string", "firewallGroupName"],
		["pos", "path", "integer", "firewallRulePos"],
	]],
	["/api2/json/cluster/firewall/ipset", "getClusterFirewallIPSets", "cluster", []],
	["/api2/json/cluster/firewall/ipset/{name}", "getClusterFirewallIPSet", "cluster", [
		["name", "path", "string", "firewallIPSetName"],
	]],

	// ---- cluster/sdn ----
	["/api2/json/cluster/sdn", "getClusterSDN", "cluster", []],
	["/api2/json/cluster/sdn/vnets", "getClusterSDNVnets", "cluster", []],
	["/api2/json/cluster/sdn/vnets/{vnet}", "getClusterSDNVnet", "cluster", [
		["vnet", "path", "string", "sdnVnet"],
	]],
	["/api2/json/cluster/sdn/zones", "getClusterSDNZones", "cluster", []],
	["/api2/json/cluster/sdn/zones/{zone}", "getClusterSDNZone", "cluster", [
		["zone", "path", "string", "sdnZone"],
	]],
	["/api2/json/cluster/sdn/controllers", "getClusterSDNControllers", "cluster", []],
	["/api2/json/cluster/sdn/controllers/{controller}", "getClusterSDNController", "cluster", [
		["controller", "path", "string", "sdnController"],
	]],

	// ---- cluster/acme ----
	["/api2/json/cluster/acme", "getClusterAcme", "cluster", []],
	["/api2/json/cluster/acme/tos", "getClusterAcmeTos", "cluster", []],
	["/api2/json/cluster/acme/directories", "getClusterAcmeDirectories", "cluster", []],
	["/api2/json/cluster/acme/plugins", "getClusterAcmePlugins", "cluster", []],
	["/api2/json/cluster/acme/plugins/{id}", "getClusterAcmePlugin", "cluster", [
		["id", "path", "string", "acmePlugin"],
	]],

	// ---- cluster/metrics ----
	["/api2/json/cluster/metrics/server", "getClusterMetricsServer", "cluster", []],
	["/api2/json/cluster/metrics/server/{id}", "getClusterMetricsServerSingle", "cluster", [
		["id", "path", "string", "metricsServer"],
	]],

	// ---- cluster/ceph ----
	["/api2/json/cluster/ceph", "getClusterCeph", "cluster", []],

	// ---- nodes ----
	["/api2/json/nodes", "getNodes", "nodes", []],
	["/api2/json/nodes/{node}", "getNodesSingle", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/status", "getNodesSingleStatus", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/version", "getNodesSingleVersion", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/config", "getNodesSingleConfig", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/dns", "getNodesSingleDns", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/netstat", "getNodesSingleNetstat", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/report", "getNodesSingleReport", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/rrd", "getNodeRRD", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/rrddata", "getNodeRRDData", "nodes", [
		["node", "path", "string", "node"],
	]],

	// ---- nodes/{node}/tasks ----
	["/api2/json/nodes/{node}/tasks", "getNodeTasks", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/tasks/{upid}", "getNodeTask", "nodes", [
		["node", "path", "string", "node"],
		["upid", "path", "string", "upid"],
	]],
	["/api2/json/nodes/{node}/tasks/{upid}/status", "getNodeTaskStatus", "nodes", [
		["node", "path", "string", "node"],
		["upid", "path", "string", "upid"],
	]],
	["/api2/json/nodes/{node}/tasks/{upid}/log", "getNodeTaskLog", "nodes", [
		["node", "path", "string", "node"],
		["upid", "path", "string", "upid"],
	]],

	// ---- nodes/{node}/replication ----
	["/api2/json/nodes/{node}/replication", "getNodesSingleReplication", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/replication/{id}/status", "getNodesSingleReplicationSingleStatus", "nodes", [
		["node", "path", "string", "node"],
		["id", "path", "string", "replicationId"],
	]],

	// ---- nodes/{node}/network ----
	["/api2/json/nodes/{node}/network", "getNodesSingleNetwork", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/network/{iface}", "getNodesSingleNetworkSingle", "nodes", [
		["node", "path", "string", "node"],
		["iface", "path", "string", "iface"],
	]],

	// ---- nodes/{node}/sdn ----
	["/api2/json/nodes/{node}/sdn", "getNodeSDN", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/sdn/zones", "getNodeSDNZones", "nodes", [
		["node", "path", "string", "node"],
	]],

	// ---- nodes/{node}/storage ----
	["/api2/json/nodes/{node}/storage", "getNodesSingleStorage", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/storage/{storage}", "getNodesSingleStorageSingle", "nodes", [
		["node", "path", "string", "node"],
		["storage", "path", "string", "storage"],
	]],
	["/api2/json/nodes/{node}/storage/{storage}/status", "getNodesSingleStorageSingleStatus", "nodes", [
		["node", "path", "string", "node"],
		["storage", "path", "string", "storage"],
	]],
	["/api2/json/nodes/{node}/storage/{storage}/content", "getNodesSingleStorageSingleContent", "nodes", [
		["node", "path", "string", "node"],
		["storage", "path", "string", "storage"],
	]],
	["/api2/json/nodes/{node}/storage/{storage}/content/{volume}", "getNodesSingleStorageSingleContentSingle", "nodes", [
		["node", "path", "string", "node"],
		["storage", "path", "string", "storage"],
		["volume", "path", "string", "volume"],
	]],
	["/api2/json/nodes/{node}/storage/{storage}/rrd", "getNodesSingleStorageSingleRrd", "nodes", [
		["node", "path", "string", "node"],
		["storage", "path", "string", "storage"],
	]],
	["/api2/json/nodes/{node}/storage/{storage}/rrddata", "getNodesSingleStorageSingleRrddata", "nodes", [
		["node", "path", "string", "node"],
		["storage", "path", "string", "storage"],
	]],
	["/api2/json/nodes/{node}/storage/{storage}/prunebackups", "getNodesSingleStorageSinglePrunebackups", "nodes", [
		["node", "path", "string", "node"],
		["storage", "path", "string", "storage"],
	]],

	// ---- nodes/{node}/disks ----
	["/api2/json/nodes/{node}/disks", "getNodesSingleDisks", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/disks/list", "getNodesSingleDisksList", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/disks/directory", "getNodesSingleDisksDirectory", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/disks/smart", "getNodesSingleDisksSmart", "nodes", [
		["node", "path", "string", "node"],
	]],

	// ---- nodes/{node}/services ----
	["/api2/json/nodes/{node}/services", "getNodesSingleServices", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/services/{service}/state", "getNodesSingleServicesSingleState", "nodes", [
		["node", "path", "string", "node"],
		["service", "path", "string", "service"],
	]],

	// ---- nodes/{node}/certificates ----
	["/api2/json/nodes/{node}/certificates", "getNodesSingleCertificates", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/certificates/info", "getNodesSingleCertificatesInfo", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/certificates/acme", "getNodesSingleCertificatesAcme", "nodes", [
		["node", "path", "string", "node"],
	]],

	// ---- nodes/{node}/firewall ----
	["/api2/json/nodes/{node}/firewall", "getNodeFirewall", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/firewall/options", "getNodeFirewallOptions", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/firewall/rules", "getNodeFirewallRules", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/firewall/log", "getNodesSingleFirewallLog", "nodes", [
		["node", "path", "string", "node"],
	]],

	// ---- nodes/{node}/scan ----
	["/api2/json/nodes/{node}/scan", "getNodesSingleScan", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/scan/nfs", "getNodesSingleScanNfs", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/scan/iscsi", "getNodesSingleScanIscsi", "nodes", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/scan/glusterfs", "getNodesSingleScanGlusterfs", "nodes", [
		["node", "path", "string", "node"],
	]],

	// ---- nodes/{node}/ceph ----
	["/api2/json/nodes/{node}/ceph/disks", "getNodesSingleCephDisks", "nodes", [
		["node", "path", "string", "node"],
	]],

	// ---- nodes/{node}/vzdump ----
	["/api2/json/nodes/{node}/vzdump/extractconfig", "getNodesSingleVzdumpExtractconfig", "nodes", [
		["node", "path", "string", "node"],
	]],

	// ---- nodes/{node}/qemu ----
	["/api2/json/nodes/{node}/qemu", "getVMs", "qemu", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}", "getVM", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/status", "getVMStatus", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/status/current", "getCurrentVMStatus", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/config", "getVMConfig", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/pending", "getVMConfigPending", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/feature", "getNodesSingleQemuSingleFeature", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/migrate", "migrateVM", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/rrd", "getVMRRD", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/rrddata", "getVMRRDData", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/cloudinit/dump", "getNodesSingleQemuSingleCloudinitDump", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],

	// ---- nodes/{node}/qemu/{vmid}/snapshot ----
	["/api2/json/nodes/{node}/qemu/{vmid}/snapshot", "getVMSnapshots", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/snapshot/{snapname}", "getVMSnapshot", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
		["snapname", "path", "string", "snapname"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config", "getVMSnapshotConfig", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
		["snapname", "path", "string", "snapname"],
	]],

	// ---- nodes/{node}/qemu/{vmid}/firewall ----
	["/api2/json/nodes/{node}/qemu/{vmid}/firewall", "getVMFirewall", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/firewall/options", "getVMFirewallOptions", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/firewall/rules", "getVMFirewallRules", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/firewall/rules/{pos}", "getVMFirewallRule", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
		["pos", "path", "integer", "vmFirewallRulePos"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/firewall/log", "getNodesSingleQemuSingleFirewallLog", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/firewall/aliases", "getNodesSingleQemuSingleFirewallAliases", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/firewall/ipset", "getVMFirewallIPSets", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/firewall/ipset/{name}", "getVMFirewallIPSet", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
		["name", "path", "string", "firewallIPSetName"],
	]],

	// ---- nodes/{node}/qemu/{vmid}/agent ----
	["/api2/json/nodes/{node}/qemu/{vmid}/agent", "getNodesSingleQemuSingleAgent", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/info", "getNodesSingleQemuSingleAgentInfo", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/get-osinfo", "getNodesSingleQemuSingleAgentGetosinfo", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/get-fsinfo", "getNodesSingleQemuSingleAgentGetfsinfo", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/get-vcpus", "getNodesSingleQemuSingleAgentGetvcpus", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/get-memory-blocks", "getNodesSingleQemuSingleAgentGetmemoryblocks", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/get-users", "getNodesSingleQemuSingleAgentGetusers", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/get-host-name", "getNodesSingleQemuSingleAgentGethostname", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/get-timezone", "getNodesSingleQemuSingleAgentGettimezone", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces", "getNodesSingleQemuSingleAgentNetworkgetinterfaces", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],
	["/api2/json/nodes/{node}/qemu/{vmid}/agent/exec-status", "getNodesSingleQemuSingleAgentExecstatus", "qemu", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "vmid"],
	]],

	// ---- nodes/{node}/lxc ----
	["/api2/json/nodes/{node}/lxc", "getNodesSingleLxc", "lxc", [
		["node", "path", "string", "node"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}", "getNodesSingleLxcSingle", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/status", "getNodesSingleLxcSingleStatus", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/status/current", "getNodesSingleLxcSingleStatusCurrent", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/config", "getNodesSingleLxcSingleConfig", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/pending", "getNodesSingleLxcSinglePending", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/feature", "getNodesSingleLxcSingleFeature", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/rrd", "getNodesSingleLxcSingleRrd", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/rrddata", "getNodesSingleLxcSingleRrddata", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],

	// ---- nodes/{node}/lxc/{vmid}/snapshot ----
	["/api2/json/nodes/{node}/lxc/{vmid}/snapshot", "getNodesSingleLxcSingleSnapshot", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/snapshot/{snapname}", "getNodesSingleLxcSingleSnapshotSingle", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
		["snapname", "path", "string", "lxcSnapname"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config", "getNodesSingleLxcSingleSnapshotSingleConfig", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
		["snapname", "path", "string", "lxcSnapname"],
	]],

	// ---- nodes/{node}/lxc/{vmid}/firewall ----
	["/api2/json/nodes/{node}/lxc/{vmid}/firewall", "getNodesSingleLxcSingleFirewall", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/firewall/options", "getNodesSingleLxcSingleFirewallOptions", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/firewall/rules", "getNodesSingleLxcSingleFirewallRules", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],
	["/api2/json/nodes/{node}/lxc/{vmid}/firewall/log", "getNodesSingleLxcSingleFirewallLog", "lxc", [
		["node", "path", "string", "node"],
		["vmid", "path", "integer", "lxcid"],
	]],

	// ---- access ----
	["/api2/json/access", "getAccess", "access", []],
	["/api2/json/access/acl", "getAccessAcl", "access", []],
	["/api2/json/access/permissions", "getAccessPermissions", "access", []],
	["/api2/json/access/users", "getAccessUsers", "access", []],
	["/api2/json/access/users/{userid}", "getAccessUsersSingle", "access", [
		["userid", "path", "string", "userid"],
	]],
	["/api2/json/access/users/{userid}/tfa", "getAccessUsersSingleTfa", "access", [
		["userid", "path", "string", "userid"],
	]],
	["/api2/json/access/users/{userid}/token", "getAccessUsersSingleToken", "access", [
		["userid", "path", "string", "userid"],
	]],
	["/api2/json/access/users/{userid}/token/{tokenid}", "getAccessUsersSingleTokenSingle", "access", [
		["userid", "path", "string", "userid"],
		["tokenid", "path", "string", "tokenid"],
	]],
	["/api2/json/access/groups", "getAccessGroups", "access", []],
	["/api2/json/access/groups/{groupid}", "getAccessGroupsSingle", "access", [
		["groupid", "path", "string", "groupid"],
	]],
	["/api2/json/access/roles", "getAccessRoles", "access", []],
	["/api2/json/access/roles/{roleid}", "getAccessRolesSingle", "access", [
		["roleid", "path", "string", "roleid"],
	]],
	["/api2/json/access/domains", "getAccessDomains", "access", []],
	["/api2/json/access/domains/{realm}", "getAccessDomainsSingle", "access", [
		["realm", "path", "string", "realm"],
	]],

	// ---- pools ----
	["/api2/json/pools", "getPools", "pools", []],
	["/api2/json/pools/{poolid}", "getPool", "pools", [
		["poolid", "path", "string", "poolid"],
	]],

	// ---- storage ----
	["/api2/json/storage", "getStorage", "storage", []],
	["/api2/json/storage/{storage}", "getStorageSingle", "storage", [
		["storage", "path", "string", "storage"],
	]],
];

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function resolveParam(ctx: DiscoveryContext, ctxKey: string): string | null {
	const value = ctx[ctxKey as keyof DiscoveryContext];
	if (value === undefined || value === "") return null;
	return value;
}

function substitutePath(template: string, params: [string, string, string, string][], ctx: DiscoveryContext): string | null {
	let result = template;
	for (const [name, , , ctxKey] of params) {
		const value = resolveParam(ctx, ctxKey);
		if (value === null) return null;
		result = result.replace(`{${name}}`, encodeURIComponent(value));
	}
	return result;
}

function stripApiPrefix(apiPath: string): string {
	// Convert /api2/json/nodes/{node}/status to /nodes/{node}/status
	return apiPath.replace(/^\/api2\/json/, "");
}

async function collectEndpoints(
	client: FetchClient,
	ctx: DiscoveryContext,
	dryRun: boolean,
): Promise<Observation[]> {
	const observations: Observation[] = [];
	let okCount = 0;
	let skippedCount = 0;
	let failedCount = 0;

	for (const [pathTemplate, operationId, tagsCsv, params] of ENDPOINTS) {
		const tags = tagsCsv.split(",").map((t) => t.trim()).filter(Boolean);
		const displayPath = stripApiPrefix(pathTemplate);

		// Build parameter list for the observation
		const observationParams: ObservationParam[] = params.map(([name, loc, type]) => ({
			name,
			in: loc,
			type,
		}));

		// Substitute parameters
		const resolvedUrl = substitutePath(pathTemplate, params, ctx);
		if (resolvedUrl === null) {
			console.log(`  [skip] ${operationId} — missing param`);
			skippedCount++;
			observations.push({
				path: displayPath,
				operationId,
				tags,
				parameters: observationParams,
				schema: null,
			});
			continue;
		}

		if (dryRun) {
			console.log(`  [dry-run] ${operationId} -> GET ${resolvedUrl}`);
			skippedCount++;
			observations.push({
				path: displayPath,
				operationId,
				tags,
				parameters: observationParams,
				schema: null,
			});
			continue;
		}

		try {
			const resp = await client.get(resolvedUrl);
			const body = resp.data as Record<string, unknown>;
			const data = body["data"];
			const schema = data !== undefined ? inferSchema(data) : null;
			observations.push({
				path: displayPath,
				operationId,
				tags,
				parameters: observationParams,
				schema,
			});
			okCount++;
			console.log(`  [ok] ${operationId}`);
		} catch (err: unknown) {
			const status = err instanceof FetchError ? err.status : "?";
			console.log(`  [fail] ${operationId} — ${status}`);
			failedCount++;
			observations.push({
				path: displayPath,
				operationId,
				tags,
				parameters: observationParams,
				schema: null,
			});
		}
	}

	console.log(`\nCollection complete: ${okCount} ok, ${skippedCount} skipped, ${failedCount} failed`);
	return observations;
}

// ---------------------------------------------------------------------------
// OpenAPI Builder
// ---------------------------------------------------------------------------

interface OpenApiSpec {
	openapi: string;
	info: {
		title: string;
		version: string;
		description: string;
	};
	paths: Record<string, Record<string, OpenApiOperation>>;
}

interface OpenApiOperation {
	operationId: string;
	summary: string;
	tags: string[];
	parameters?: OpenApiParameter[];
	responses: Record<string, OpenApiResponse>;
}

interface OpenApiParameter {
	name: string;
	in: string;
	required: boolean;
	schema: { type: string };
}

interface OpenApiResponse {
	description: string;
	content?: {
		"application/json": {
			schema: JsonSchema;
		};
	};
}

function buildOpenApiSpec(observations: Observation[]): OpenApiSpec {
	const paths: Record<string, Record<string, OpenApiOperation>> = {};

	for (const obs of observations) {
		const operation: OpenApiOperation = {
			operationId: obs.operationId,
			summary: obs.operationId,
			tags: obs.tags,
			responses: {},
		};

		if (obs.parameters.length > 0) {
			operation.parameters = obs.parameters.map((p) => ({
				name: p.name,
				in: p.in,
				required: true,
				schema: { type: p.type },
			}));
		}

		if (obs.schema) {
			operation.responses["200"] = {
				description: `${obs.operationId}Response`,
				content: {
					"application/json": {
						schema: obs.schema,
					},
				},
			};
		} else {
			operation.responses["200"] = {
				description: `${obs.operationId}Response`,
			};
		}

		if (!paths[obs.path]) {
			paths[obs.path] = {};
		}
		paths[obs.path]["get"] = operation;
	}

	return {
		openapi: "3.0.0",
		info: {
			title: "Proxmox VE API (enriched)",
			version: "1.0.0",
			description: "Proxmox VE REST API with response schemas inferred from live instance. Generated by proxmoxEnrich.ts.",
		},
		paths,
	};
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
	.name("proxmoxEnrich")
	.description("Enrich Proxmox API spec by calling live endpoints and inferring response schemas")
	.option("--dry-run", "Resolve endpoints but do not make HTTP calls", false)
	.option("--skip-ssl", "Disable SSL certificate verification", false)
	.option("-o, --output <path>", "Output YAML file path", "proxmox_enriched.yaml")
	.action(async (opts: { dryRun: boolean; skipSsl: boolean; output: string }) => {
		console.log("=== Proxmox API Enrichment ===\n");

		// Load auth
		console.log("[auth] Loading encrypted token...");
		const authToken = loadAuth();
		console.log("[auth] Token decrypted successfully\n");

		// Create HTTP client
		const client = createClient(authToken, opts.skipSsl);

		// Discover resources
		console.log("[discover] Starting resource discovery...\n");
		const ctx = await discover(client);
		if (!ctx.node) {
			console.error("Discovery failed — no node found. Exiting.");
			process.exit(1);
		}

		// Collect endpoint responses
		console.log("\n[collect] Calling endpoints...\n");
		const observations = await collectEndpoints(client, ctx, opts.dryRun);

		// Save raw observations
		const observationsPath = path.resolve("proxmox_observations.json");
		await fs.writeFile(observationsPath, JSON.stringify(observations, null, 2), "utf-8");
		console.log(`\nSaved observations to ${observationsPath}`);

		// Build OpenAPI spec
		const spec = buildOpenApiSpec(observations);
		const outputPath = path.resolve(opts.output);
		await fs.writeFile(outputPath, YAML.stringify(spec, { lineWidth: 120 }), "utf-8");

		const pathCount = Object.keys(spec.paths).length;
		const withSchema = observations.filter((o) => o.schema !== null).length;
		console.log(`Wrote ${pathCount} paths (${withSchema} with inferred schemas) to ${outputPath}`);
	});

program.parse();
