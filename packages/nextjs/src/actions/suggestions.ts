// ---------------------------------------------------------------------------
// Suggestion pool — starter questions shown on the empty chat screen.
//
// Every question maps to one or more real endpoints from the OpenAPI specs
// loaded into the retriever. Cross-API questions are intentionally chained on
// shared identifiers (IP, MAC, hostname, device-id) so the answers can walk
// from one spec to the next.
//
// Mapping notes per API:
//   - Microsoft Graph: only device endpoints are loaded (msgraph-devices*),
//     so questions never reference users/groups/sign-ins directly. Owner/user
//     lookups go through /devices/{id}/registeredOwners and registeredUsers.
//   - Anthropic: spec exposes /v1/messages, /v1/messages/batches and
//     /v1/messages/count_tokens — no file-upload endpoint exists.
//   - Darktrace: questions use real paths (/devices, /modelbreaches,
//     /aianalyst/incidents, /pcaps, /advancedsearch/api/search, /antigena, …).
//   - Armis: covers both /assets/_search style and the /api/v1/* surface
//     (vulnerabilities, alerts, sites, reports, integrations, AQL search).
//   - UniFi: split between the legacy controller (/s/{site}/rest/*) and the
//     UniFi Network API v1 (/v1/sites/{siteId}/...).
//   - MikroTik: REST surface mirrors the CLI (/ip/firewall, /ip/dhcp-server,
//     /interface, /routing, /system/scheduler, …).
//   - OpenShift: many specs — core-k8s pods/services, kubevirt VMs,
//     serverless (knative), storage (PVCs / Ceph), service-mesh, …
// ---------------------------------------------------------------------------

export const SUGGESTION_POOL = [
	// =========================================================================
	// Single-API questions
	// =========================================================================

	// --- Armis ---
	"How do I get a list of all devices and their risk scores from Armis?",
	"How do I search Armis assets by custom criteria using POST /assets/_search and filter by risk level?",
	"How do I bulk update asset properties in Armis with POST /assets/_bulk?",
	"How do I create and manage sites in Armis via /settings/sites?",
	"How do I export device data from Armis using /data-export/{entity} for reporting?",
	"How do I run an AQL query against Armis using GET /api/v1/search?",
	"How do I retrieve vulnerability matches for specific devices in Armis with GET /api/v1/vulnerability-match/?",
	"How do I create and run a report in Armis using POST /api/v1/reports/{report_id}/_run/?",
	"How do I add or remove tags on a specific Armis device via /api/v1/devices/{device_id}/tags/?",
	"How do I list and patch alert statuses in Armis using PATCH /api/v1/alerts/{alert_id}/?",
	"How do I create and manage policies in Armis with POST /api/v1/policies/?",
	"How do I list and trigger an immediate scan for a VA integration in Armis via /api/v2/va-integrations/{integration_id}/_run_now/?",

	// --- Darktrace ---
	"How do I retrieve AI Analyst incidents from Darktrace via GET /aianalyst/incidents?",
	"How do I find similar devices by behavioural profile using GET /similardevices in Darktrace?",
	"How do I get connection traffic data for a device in Darktrace with GET /details?",
	"How do I look up CVEs affecting a specific device in Darktrace via GET /cves?",
	"How do I get model breach events for a device using GET /modelbreaches in Darktrace?",
	"How do I check Darktrace system health and bandwidth usage with GET /status and GET /summarystatistics?",
	"How do I filter Darktrace model breaches by minimum score threshold using the minScore parameter on GET /modelbreaches?",
	"How do I add and remove tags on a device in Darktrace via /tags/entities?",
	"How do I retrieve PCAP data for a specific device from Darktrace via GET /pcaps?",
	"How do I get a device summary aggregation from Darktrace using GET /devicesummary?",
	"How do I run an advanced search query across Darktrace event data using POST /advancedsearch/api/search?",
	"How do I list and trigger Antigena autonomous response actions in Darktrace via /antigena?",
	"How do I retrieve subnet topology and bandwidth information from Darktrace using GET /subnets?",
	"How do I acknowledge and comment on a Darktrace model breach using POST /modelbreaches/{pbid}/acknowledge and POST /modelbreaches/{pbid}/comments?",
	"How do I list AI Analyst groups and stats in Darktrace via GET /aianalyst/groups and GET /aianalyst/stats?",

	// --- UniFi ---
	"How do I list all WLAN configurations for a UniFi site via GET /s/{siteId}/rest/wlanconf?",
	"How do I create a new SSID on a UniFi controller using POST /s/{siteId}/rest/wlanconf?",
	"How do I list all network configurations for a UniFi site via GET /s/{siteId}/rest/networkconf?",
	"How do I list all adopted devices on a UniFi Network site using GET /v1/sites/{siteId}/devices?",
	"How do I create a WiFi broadcast on a UniFi Network site via POST /v1/sites/{siteId}/wifi/broadcasts?",
	"How do I list connected clients on a UniFi site using GET /v1/sites/{siteId}/clients?",
	"How do I manage pending device adoptions via GET /v1/pending-devices in the UniFi Network API?",
	"How do I manage ACL rules and reorder them on a UniFi site via /v1/sites/{siteId}/acl-rules?",
	"How do I create and revoke hotspot vouchers on a UniFi site via /v1/sites/{siteId}/hotspot/vouchers?",
	"How do I manage firewall policies and zones on a UniFi site via /v1/sites/{siteId}/firewall/policies and /firewall/zones?",
	"How do I configure DNS policies on a UniFi site via /v1/sites/{siteId}/dns/policies?",
	"How do I list VPN servers and site-to-site tunnels on a UniFi site via /v1/sites/{siteId}/vpn/servers and /vpn/site-to-site-tunnels?",

	// --- MikroTik ---
	"How do I read active firewall connections from MikroTik via /ip/firewall/connection?",
	"How do I manage firewall filter rules via the MikroTik API at /ip/firewall/filter?",
	"How do I list all DHCP leases from MikroTik with /ip/dhcp-server/lease?",
	"How do I get interface traffic statistics from MikroTik using /interface/monitor-traffic?",
	"How do I manage static routes via the MikroTik API at /ip/route?",
	"How do I configure IPSec policies and peers via /ip/ipsec on MikroTik?",
	"How do I configure BGP peers and instances on MikroTik via /routing/bgp?",
	"How do I configure OSPF instances and areas via /routing/ospf on MikroTik?",
	"How do I manage system scheduler tasks and scripts via /system/scheduler and /system/script on MikroTik?",
	"How do I list and manage VLAN interfaces on MikroTik via /interface/vlan?",
	"How do I configure WireGuard-style overlays via the OpenVPN client at /interface/ovpn-client on MikroTik?",
	"How do I manage RADIUS server entries via /radius on MikroTik?",

	// --- Proxmox ---
	"How do I list all VMs on a Proxmox node via GET /nodes/{node}/qemu?",
	"How do I check VM migration eligibility in Proxmox via GET /nodes/{node}/qemu/{vmid}/migrate?",
	"How do I create a snapshot of a VM in Proxmox via POST /nodes/{node}/qemu/{vmid}/snapshot?",
	"How do I list all LXC containers on a Proxmox node via GET /nodes/{node}/lxc?",
	"How do I get current CPU and memory usage for a Proxmox node via GET /nodes/{node}/status?",
	"How do I add a firewall rule to a Proxmox cluster via POST /cluster/firewall/rules?",
	"How do I list storage volumes on a Proxmox node via GET /nodes/{node}/storage/{storage}/content?",
	"How do I check the status of a background task on a Proxmox node via GET /nodes/{node}/tasks/{upid}/status?",
	"How do I get disk information for a specific Proxmox node via GET /nodes/{node}/disks?",
	"How do I reboot a QEMU VM on a Proxmox node via POST /nodes/{node}/qemu/{vmid}/status/reboot?",
	"How do I list cluster-wide HA resources in Proxmox via GET /cluster/ha/resources?",

	// --- ZeroTier ---
	"How do I list members of a ZeroTier network via GET /controller/network/{network_id}/member?",
	"How do I get peer latency and path info from ZeroTier via GET /peer?",
	"How do I authorise a new member on a ZeroTier network via POST /controller/network/{network_id}/member/{node_id}?",
	"How do I configure IP assignment pools for a ZeroTier network via POST /controller/network/{network_id}?",
	"How do I remove a member from a ZeroTier network via DELETE /controller/network/{network_id}/member/{node_id}?",
	"How do I check the controller status of a self-hosted ZeroTier node via GET /controller?",
	"How do I list all networks managed by a ZeroTier controller via GET /controller/network and GET /unstable/controller/network?",

	// --- OpenAI ---
	"How do I send a chat completion request to OpenAI via POST /chat/completions?",
	"How do I retrieve stored chat completions from OpenAI via GET /chat/completions and GET /chat/completions/{completion_id}?",
	"How do I create an OpenAI assistant with file search tools via POST /assistants?",
	"How do I generate embeddings with the OpenAI API via POST /embeddings?",
	"How do I create a vector store and search it for relevant chunks via /vector_stores and /vector_stores/{id}/search?",
	"How do I use the OpenAI Responses API to generate a model response via POST /responses?",
	"How do I create and manage a fine-tuning job in OpenAI via POST /fine_tuning/jobs?",
	"How do I submit a batch of requests to OpenAI via POST /batches?",
	"How do I screen text with the OpenAI Moderations API via POST /moderations?",
	"How do I transcribe audio using POST /audio/transcriptions in OpenAI?",
	"How do I generate an image with POST /images/generations in OpenAI?",

	// --- Anthropic ---
	"How do I create a message with streaming using the Anthropic API at POST /v1/messages?",
	"How do I use tool use with the Anthropic API via POST /v1/messages with the tools parameter?",
	"How do I submit an asynchronous message batch to the Anthropic API via POST /v1/messages/batches?",
	"How do I count tokens before sending a message with the Anthropic API via POST /v1/messages/count_tokens?",
	"How do I retrieve results from a completed Anthropic message batch via GET /v1/messages/batches/{message_batch_id}/results?",

	// --- Microsoft Graph (devices only) ---
	"How do I list a device's group memberships in Microsoft Graph via GET /devices/{device-id}/memberOf/graph.group?",
	"How do I check transitive group membership for a device in Microsoft Graph via GET /devices/{device-id}/transitiveMemberOf?",
	"How do I update a registered device's properties via PATCH /devices/{device-id} in Microsoft Graph?",
	"How do I track incremental device changes using Microsoft Graph delta queries via GET /devices/delta()?",
	"How do I list registered owners of a device in Microsoft Graph via GET /devices/{device-id}/registeredOwners?",
	"How do I list registered users of a device in Microsoft Graph via GET /devices/{device-id}/registeredUsers?",
	"How do I check which administrative units a device belongs to via GET /devices/{device-id}/memberOf/graph.administrativeUnit?",
	"How do I bulk-look up devices in Microsoft Graph via POST /devices/getByIds?",
	"How do I list and create extensions on a device in Microsoft Graph via /devices/{device-id}/extensions?",

	// --- OpenShift ---
	"How do I list all pods in a namespace using the OpenShift Kubernetes API at /api/v1/namespaces/{namespace}/pods?",
	"How do I manage KubeVirt virtual machines via /apis/kubevirt.io/v1/namespaces/{namespace}/virtualmachines in OpenShift?",
	"How do I deploy a Knative service for serverless workloads via /apis/serving.knative.dev/v1/namespaces/{namespace}/services in OpenShift?",
	"How do I manage persistent volume claims via /api/v1/namespaces/{namespace}/persistentvolumeclaims in OpenShift?",
	"How do I list OpenShift routes for a namespace via /apis/route.openshift.io/v1/namespaces/{namespace}/routes?",
	"How do I list and patch DeploymentConfigs via /apis/apps.openshift.io/v1/namespaces/{namespace}/deploymentconfigs in OpenShift?",
	"How do I list Istio VirtualServices via /apis/networking.istio.io/v1/namespaces/{namespace}/virtualservices in OpenShift Service Mesh?",

	// =========================================================================
	// Two-API chained questions
	// =========================================================================

	// Darktrace ↔ Armis (shared: IP / MAC / hostname)
	"How do I get a device's Darktrace breach history via GET /modelbreaches and cross-reference its Armis risk score via POST /assets/_search?",
	"How do I find devices with active Darktrace model breaches and check their Armis asset properties via POST /assets/properties/_search?",
	"How do I find devices with Darktrace model breaches and tag the matching Armis assets via POST /api/v1/devices/{device_id}/tags/?",
	"How do I find Armis devices with known vulnerabilities via /api/v1/vulnerability-match/ and look them up in Darktrace via GET /devicesearch?",

	// Darktrace ↔ ZeroTier (shared: IP)
	"How do I identify a device flagged in Darktrace and check if it has an active ZeroTier membership via GET /controller/network/{network_id}/member?",
	"How do I pull Darktrace AI Analyst incidents via GET /aianalyst/incidents and check whether affected devices are on a ZeroTier network?",
	"How do I list ZeroTier network members and check if any show anomalous behaviour by cross-referencing GET /devices in Darktrace?",

	// Armis ↔ Microsoft Graph Devices (shared: device identity)
	"How do I find a high-risk Armis asset and check if it is registered as a device in Microsoft Graph via GET /devices?",
	"How do I list unmanaged Armis devices and check if any are registered in Microsoft Graph Devices via POST /devices/getByIds?",
	"How do I list Microsoft Graph devices and check if any have active Armis alerts via GET /api/v1/alerts/?",

	// Proxmox ↔ ZeroTier (shared: IP)
	"How do I list Proxmox VMs via GET /nodes/{node}/qemu and verify which ones have joined a specific ZeroTier network?",
	"How do I check a Proxmox node's running VMs and retrieve their ZeroTier peer latency stats via GET /peer?",
	"How do I list Proxmox LXC containers via GET /nodes/{node}/lxc and check if any are active ZeroTier peers?",

	// MikroTik ↔ ZeroTier (shared: IP)
	"How do I check MikroTik firewall address lists at /ip/firewall/address-list and confirm they are not blocking ZeroTier member IPs?",
	"How do I retrieve MikroTik interface stats and correlate them with ZeroTier peer connection paths via GET /peer?",
	"How do I find a MikroTik firewall rule that might be blocking a ZeroTier peer connection?",

	// UniFi ↔ Darktrace (shared: MAC / IP)
	"How do I list UniFi devices on a site via GET /v1/sites/{siteId}/devices and check each one for Darktrace model breach events?",
	"How do I find a UniFi device by MAC address and pull its Darktrace connection traffic summary via GET /details?",
	"How do I list UniFi connected clients via GET /v1/sites/{siteId}/clients and check each one's Darktrace threat score?",

	// UniFi ↔ MikroTik (shared: network configuration)
	"How do I list UniFi firewall policies via GET /v1/sites/{siteId}/firewall/policies and compare them with MikroTik /ip/firewall/filter rules?",
	"How do I list UniFi site networks via GET /v1/sites/{siteId}/networks and create matching MikroTik /ip/address entries?",

	// OpenAI ↔ Anthropic
	"How do I generate embeddings with OpenAI POST /embeddings and then summarise the top results using Anthropic POST /v1/messages?",
	"How do I run a chat completion with OpenAI POST /chat/completions and compare the response to one from Anthropic POST /v1/messages?",

	// OpenAI ↔ Darktrace
	"How do I use OpenAI POST /chat/completions to summarise a batch of Darktrace AI Analyst incidents from GET /aianalyst/incidents?",
	"How do I generate OpenAI embeddings via POST /embeddings for Darktrace AI Analyst incident summaries to cluster related events?",
	"How do I use the OpenAI Moderations API at POST /moderations to screen Darktrace AI Analyst incident text?",
	"How do I get Darktrace device details via GET /details and feed them into an OpenAI POST /chat/completions for threat analysis?",

	// Anthropic ↔ Darktrace / Armis
	"How do I use Anthropic POST /v1/messages to analyse Darktrace model breach patterns from GET /modelbreaches and suggest Antigena actions?",
	"How do I get Armis device data via GET /api/v1/search and use Anthropic POST /v1/messages to summarise risk findings?",

	// Microsoft Graph Devices ↔ Proxmox
	"How do I list Microsoft Graph devices via GET /devices and check if any of their displayNames match running Proxmox VMs from GET /nodes/{node}/qemu?",
	"How do I list Proxmox nodes and check whether their hostnames are registered as devices in Microsoft Graph via POST /devices/getByIds?",

	// Armis ↔ UniFi (shared: MAC)
	"How do I find a device flagged in Armis via GET /api/v1/search and locate it by MAC address on a UniFi site via GET /v1/sites/{siteId}/clients?",
	"How do I list UniFi connected clients and check each one's risk profile in Armis via POST /assets/_search?",

	// MikroTik ↔ Microsoft Graph Devices
	"How do I pull MikroTik DHCP leases via /ip/dhcp-server/lease and check whether those devices are registered in Microsoft Graph via POST /devices/getByIds?",
	"How do I check MikroTik /ip/arp entries and correlate the MAC addresses with devices listed via GET /devices in Microsoft Graph?",

	// Armis ↔ Anthropic / OpenAI
	"How do I export Armis device data via GET /data-export/{entity} and use OpenAI POST /chat/completions to generate a risk summary report?",

	// OpenShift ↔ ZeroTier
	"How do I list OpenShift pods via /api/v1/namespaces/{namespace}/pods and check if their host nodes are reachable via ZeroTier GET /peer?",

	// OpenShift ↔ Proxmox
	"How do I compare OpenShift persistent volume claim usage with Proxmox storage pool content via GET /nodes/{node}/storage/{storage}/content?",

	// OpenShift ↔ Darktrace
	"How do I list OpenShift routes via /apis/route.openshift.io/v1/routes and check whether the backing service IPs appear in Darktrace GET /devicesearch?",

	// =========================================================================
	// Three-or-more-API chained questions
	// =========================================================================

	"How do I find a Darktrace-flagged device via GET /modelbreaches, check its Armis risk score via POST /assets/_search, and look up its registered owners in Microsoft Graph via GET /devices/{device-id}/registeredOwners?",
	"How do I list Proxmox VMs via GET /nodes/{node}/qemu, check their ZeroTier membership via GET /controller/network/{network_id}/member, and verify each VM is registered as a device in Microsoft Graph via POST /devices/getByIds?",
	"How do I detect a model breach via GET /modelbreaches in Darktrace, find the device in Armis via POST /assets/_search, and block its IP using a MikroTik /ip/firewall/filter rule?",
	"How do I get Darktrace AI Analyst incidents via GET /aianalyst/incidents, enrich them with Armis asset data via POST /assets/_search, and summarise with Anthropic POST /v1/messages?",
	"How do I find a UniFi device via GET /v1/sites/{siteId}/devices, check for Darktrace breaches via GET /modelbreaches, and look up the registered owners in Microsoft Graph via GET /devices/{device-id}/registeredOwners?",
	"How do I list ZeroTier network members via GET /controller/network/{network_id}/member, resolve their IPs against MikroTik DHCP leases at /ip/dhcp-server/lease, and check for Darktrace activity via GET /devicesearch?",
	"How do I identify a high-risk Armis asset via POST /assets/_search, check its Darktrace breach history via GET /modelbreaches, and verify its Microsoft Graph device registration via GET /devices?",
	"How do I audit Proxmox VMs via GET /nodes/{node}/qemu, cross-reference their hostnames against Microsoft Graph devices via POST /devices/getByIds, then check each VM's ZeroTier reachability via GET /peer?",
	"How do I pull UniFi connected clients via GET /v1/sites/{siteId}/clients, look up each in Armis for risk via POST /assets/_search, and flag suspicious ones in Darktrace via POST /tags/entities?",
	"How do I find a MikroTik /ip/firewall/filter rule blocking traffic, trace the source device in Darktrace via GET /devicesearch, and check its Armis profile and Microsoft Graph device registration?",
	"How do I get MikroTik interface traffic stats, identify top talkers in Darktrace via GET /devices, and look up their Armis asset profiles via POST /assets/_search?",
	"How do I audit UniFi clients via GET /v1/sites/{siteId}/clients, cross-reference with Armis risk scores via POST /assets/_search, and check for Darktrace model breaches via GET /modelbreaches?",
	"How do I list OpenShift KubeVirt VMs via /apis/kubevirt.io/v1/namespaces/{namespace}/virtualmachines, match them to Proxmox VMs by name via GET /nodes/{node}/qemu, and check ZeroTier connectivity via GET /peer for each?",
	"How do I pull Darktrace model breaches via GET /modelbreaches, enrich each with Armis device data via POST /assets/_search, classify severity using OpenAI POST /chat/completions, and confirm device registration in Microsoft Graph via POST /devices/getByIds?",
	"How do I inventory UniFi site devices via GET /v1/sites/{siteId}/devices, check each for Darktrace alerts via GET /modelbreaches, look up Armis risk scores via POST /assets/_search, and generate a report with Anthropic POST /v1/messages?",
	"How do I list ZeroTier members via GET /controller/network/{network_id}/member, resolve their IPs via MikroTik /ip/arp, and check each device's status in both Darktrace GET /devicesearch and Armis POST /assets/_search?",
];

/**
 * Removes endpoint-route hints (e.g. "via GET /modelbreaches",
 * "at POST /assets/_search", "with /ip/firewall/filter") from a suggestion
 * string for display purposes. The full string — routes included — is still
 * sent to the LLM when the user clicks the button; only the visible label
 * is cleaned up.
 *
 * The chained-question variants (3+ APIs) leave behind reasonable English
 * after stripping because the optional preposition is consumed alongside
 * the route, e.g.:
 *   "X via GET /a, Y via POST /b, and Z via GET /c?" → "X, Y, and Z?"
 */
export const stripRoutes = (text: string): string => {
	const PATH_CHARS = String.raw`[\w\-\{\}\.\/]+`;
	const PREPS = String.raw`(?:via|using|at|with|through|from|by)`;
	const METHODS = String.raw`(?:GET|POST|PUT|DELETE|PATCH)`;

	let out = text;

	// "[preposition] [and] METHOD /path" — capture the optional preceding
	// preposition and/or "and" so the leftover sentence reads naturally.
	out = out.replace(
		new RegExp(String.raw`(?:\s+${PREPS})?(?:\s+and)?\s+${METHODS}\s+\/${PATH_CHARS}`, "g"),
		"",
	);

	// "preposition /path" (no method)
	out = out.replace(
		new RegExp(String.raw`\s+${PREPS}\s+\/${PATH_CHARS}`, "gi"),
		"",
	);

	// Any orphaned preposition left dangling before punctuation or a
	// conjunction (e.g. "...Microsoft Graph via?" → "...Microsoft Graph?").
	out = out.replace(
		new RegExp(String.raw`\s+${PREPS}(?=[,?.]|\s+(?:and|then|or)\b)`, "gi"),
		"",
	);

	// Cosmetic cleanup
	out = out
		.replace(/,\s*,/g, ",")
		.replace(/\s+,/g, ",")
		.replace(/\s+/g, " ")
		.replace(/\s+([?.])/g, "$1")
		.trim();

	return out;
};
