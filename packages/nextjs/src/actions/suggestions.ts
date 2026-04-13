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
//     lookups go through device-scoped relationships.
//   - Anthropic: spec exposes messages, batches and count_tokens — no
//     file-upload endpoint exists.
//   - Darktrace: covers devices, modelbreaches, AI analyst incidents, pcaps,
//     advanced search, antigena, etc.
//   - Armis: covers both the legacy /assets/_search surface and the
//     /api/v1/* surface (vulnerabilities, alerts, sites, reports,
//     integrations, AQL search).
//   - UniFi: split between the legacy controller (sites/rest/*) and the
//     UniFi Network API v1 (sites/{siteId}/...).
//   - MikroTik: REST surface mirrors the CLI (firewall, dhcp, interface,
//     routing, scheduler, …).
//   - OpenShift: many specs — core-k8s pods/services, KubeVirt VMs,
//     serverless (Knative), storage (PVCs / Ceph), service-mesh, …
// ---------------------------------------------------------------------------

export const SUGGESTION_POOL = [
	// =========================================================================
	// Single-API questions
	// =========================================================================

	// --- Armis ---
	"How do I get a list of all devices and their risk scores from Armis?",
	"How do I search Armis assets by custom criteria and filter by risk level?",
	"How do I bulk update asset properties in Armis?",
	"How do I create and manage sites in Armis?",
	"How do I export device data from Armis for reporting?",
	"How do I run an AQL query against Armis?",
	"How do I retrieve vulnerability matches for specific devices in Armis?",
	"How do I create and run a report in Armis?",
	"How do I add or remove tags on a specific Armis device?",
	"How do I list and patch alert statuses in Armis?",
	"How do I create and manage policies in Armis?",
	"How do I list and trigger an immediate scan for a VA integration in Armis?",

	// --- Darktrace ---
	"How do I retrieve AI Analyst incidents from Darktrace?",
	"How do I find similar devices by behavioural profile in Darktrace?",
	"How do I get connection traffic data for a device in Darktrace?",
	"How do I look up CVEs affecting a specific device in Darktrace?",
	"How do I get model breach events for a device in Darktrace?",
	"How do I check Darktrace system health and bandwidth usage?",
	"How do I filter Darktrace model breaches by minimum score threshold?",
	"How do I add and remove tags on a device in Darktrace?",
	"How do I retrieve PCAP data for a specific device from Darktrace?",
	"How do I get a device summary aggregation from Darktrace?",
	"How do I run an advanced search query across Darktrace event data?",
	"How do I list and trigger Antigena autonomous response actions in Darktrace?",
	"How do I retrieve subnet topology and bandwidth information from Darktrace?",
	"How do I acknowledge and comment on a Darktrace model breach?",
	"How do I list AI Analyst groups and stats in Darktrace?",

	// --- UniFi ---
	"How do I list all WLAN configurations for a UniFi site?",
	"How do I create a new SSID on a UniFi controller?",
	"How do I list all network configurations for a UniFi site?",
	"How do I list all adopted devices on a UniFi Network site?",
	"How do I create a WiFi broadcast on a UniFi Network site?",
	"How do I list connected clients on a UniFi site?",
	"How do I manage pending device adoptions in the UniFi Network API?",
	"How do I manage ACL rules and reorder them on a UniFi site?",
	"How do I create and revoke hotspot vouchers on a UniFi site?",
	"How do I manage firewall policies and zones on a UniFi site?",
	"How do I configure DNS policies on a UniFi site?",
	"How do I list VPN servers and site-to-site tunnels on a UniFi site?",

	// --- MikroTik ---
	"How do I read active firewall connections from MikroTik?",
	"How do I manage firewall filter rules via the MikroTik API?",
	"How do I list all DHCP leases from MikroTik?",
	"How do I get interface traffic statistics from MikroTik?",
	"How do I manage static routes via the MikroTik API?",
	"How do I configure IPSec policies and peers on MikroTik?",
	"How do I configure BGP peers and instances on MikroTik?",
	"How do I configure OSPF instances and areas on MikroTik?",
	"How do I manage system scheduler tasks and scripts on MikroTik?",
	"How do I list and manage VLAN interfaces on MikroTik?",
	"How do I configure an OpenVPN client on MikroTik?",
	"How do I manage RADIUS server entries on MikroTik?",

	// --- Proxmox ---
	"How do I list all VMs on a Proxmox node?",
	"How do I check VM migration eligibility in Proxmox?",
	"How do I create a snapshot of a VM in Proxmox?",
	"How do I list all LXC containers on a Proxmox node?",
	"How do I get current CPU and memory usage for a Proxmox node?",
	"How do I add a firewall rule to a Proxmox cluster?",
	"How do I list storage volumes on a Proxmox node?",
	"How do I check the status of a background task on a Proxmox node?",
	"How do I get disk information for a specific Proxmox node?",
	"How do I reboot a QEMU VM on a Proxmox node?",
	"How do I list cluster-wide HA resources in Proxmox?",

	// --- ZeroTier ---
	"How do I list members of a ZeroTier network?",
	"How do I get peer latency and path info from ZeroTier?",
	"How do I authorise a new member on a ZeroTier network?",
	"How do I configure IP assignment pools for a ZeroTier network?",
	"How do I remove a member from a ZeroTier network?",
	"How do I check the controller status of a self-hosted ZeroTier node?",
	"How do I list all networks managed by a ZeroTier controller?",

	// --- OpenAI ---
	"How do I send a chat completion request to OpenAI?",
	"How do I retrieve stored chat completions from OpenAI?",
	"How do I create an OpenAI assistant with file search tools?",
	"How do I generate embeddings with the OpenAI API?",
	"How do I create a vector store and search it for relevant chunks in OpenAI?",
	"How do I use the OpenAI Responses API to generate a model response?",
	"How do I create and manage a fine-tuning job in OpenAI?",
	"How do I submit a batch of requests to OpenAI?",
	"How do I screen text with the OpenAI Moderations API?",
	"How do I transcribe audio with the OpenAI API?",
	"How do I generate an image with the OpenAI API?",

	// --- Anthropic ---
	"How do I create a streaming message with the Anthropic API?",
	"How do I use tool use with the Anthropic API?",
	"How do I submit an asynchronous message batch to the Anthropic API?",
	"How do I count tokens before sending a message with the Anthropic API?",
	"How do I retrieve results from a completed Anthropic message batch?",

	// --- Microsoft Graph (devices only) ---
	"How do I list a device's group memberships in Microsoft Graph?",
	"How do I check transitive group membership for a device in Microsoft Graph?",
	"How do I update a registered device's properties in Microsoft Graph?",
	"How do I track incremental device changes using Microsoft Graph delta queries?",
	"How do I list registered owners of a device in Microsoft Graph?",
	"How do I list registered users of a device in Microsoft Graph?",
	"How do I check which administrative units a device belongs to in Microsoft Graph?",
	"How do I bulk-look up devices in Microsoft Graph?",
	"How do I list and create extensions on a device in Microsoft Graph?",

	// --- OpenShift ---
	"How do I list all pods in a namespace on the OpenShift Kubernetes API?",
	"How do I manage KubeVirt virtual machines on OpenShift?",
	"How do I deploy a Knative service for serverless workloads on OpenShift?",
	"How do I manage persistent volume claims on OpenShift?",
	"How do I list OpenShift routes for a namespace?",
	"How do I list and patch DeploymentConfigs on OpenShift?",
	"How do I list Istio VirtualServices on OpenShift Service Mesh?",

	// =========================================================================
	// Two-API chained questions
	// =========================================================================

	// Darktrace ↔ Armis (shared: IP / MAC / hostname)
	"How do I get a device's Darktrace breach history and cross-reference its Armis risk score?",
	"How do I find devices with active Darktrace model breaches and check their Armis asset properties?",
	"How do I find devices with Darktrace model breaches and tag the matching Armis assets?",
	"How do I find Armis devices with known vulnerabilities and look them up in Darktrace?",

	// Darktrace ↔ ZeroTier (shared: IP)
	"How do I identify a device flagged in Darktrace and check if it has an active ZeroTier membership?",
	"How do I pull Darktrace AI Analyst incidents and check whether affected devices are on a ZeroTier network?",
	"How do I list ZeroTier network members and check if any show anomalous behaviour in Darktrace?",

	// Armis ↔ Microsoft Graph Devices (shared: device identity)
	"How do I find a high-risk Armis asset and check if it is registered as a device in Microsoft Graph?",
	"How do I list unmanaged Armis devices and check if any are registered in Microsoft Graph Devices?",
	"How do I list Microsoft Graph devices and check if any have active Armis alerts?",

	// Proxmox ↔ ZeroTier (shared: IP)
	"How do I list Proxmox VMs and verify which ones have joined a specific ZeroTier network?",
	"How do I check a Proxmox node's running VMs and retrieve their ZeroTier peer latency stats?",
	"How do I list Proxmox LXC containers and check if any are active ZeroTier peers?",

	// MikroTik ↔ ZeroTier (shared: IP)
	"How do I check MikroTik firewall address lists and confirm they are not blocking ZeroTier member IPs?",
	"How do I retrieve MikroTik interface stats and correlate them with ZeroTier peer connection paths?",
	"How do I find a MikroTik firewall rule that might be blocking a ZeroTier peer connection?",

	// UniFi ↔ Darktrace (shared: MAC / IP)
	"How do I list UniFi devices on a site and check each one for Darktrace model breach events?",
	"How do I find a UniFi device by MAC address and pull its Darktrace connection traffic summary?",
	"How do I list UniFi connected clients and check each one's Darktrace threat score?",

	// UniFi ↔ MikroTik (shared: network configuration)
	"How do I list UniFi firewall policies and compare them with MikroTik filter rules?",
	"How do I list UniFi site networks and create matching MikroTik IP address entries?",

	// OpenAI ↔ Anthropic
	"How do I generate embeddings with OpenAI and then summarise the top results with Anthropic?",
	"How do I run a chat completion with OpenAI and compare the response to one from Anthropic?",

	// OpenAI ↔ Darktrace
	"How do I use OpenAI to summarise a batch of Darktrace AI Analyst incidents?",
	"How do I generate OpenAI embeddings for Darktrace AI Analyst incident summaries to cluster related events?",
	"How do I use the OpenAI Moderations API to screen Darktrace AI Analyst incident text?",
	"How do I get Darktrace device details and feed them into an OpenAI chat completion for threat analysis?",

	// Anthropic ↔ Darktrace / Armis
	"How do I use Anthropic to analyse Darktrace model breach patterns and suggest Antigena actions?",
	"How do I get Armis device data and use Anthropic to summarise risk findings?",

	// Microsoft Graph Devices ↔ Proxmox
	"How do I list Microsoft Graph devices and check if any of their displayNames match running Proxmox VMs?",
	"How do I list Proxmox nodes and check whether their hostnames are registered as devices in Microsoft Graph?",

	// Armis ↔ UniFi (shared: MAC)
	"How do I find a device flagged in Armis and locate it by MAC address on a UniFi site?",
	"How do I list UniFi connected clients and check each one's risk profile in Armis?",

	// MikroTik ↔ Microsoft Graph Devices
	"How do I pull MikroTik DHCP leases and check whether those devices are registered in Microsoft Graph?",
	"How do I check MikroTik ARP entries and correlate the MAC addresses with devices listed in Microsoft Graph?",

	// Armis ↔ Anthropic / OpenAI
	"How do I export Armis device data and use OpenAI to generate a risk summary report?",

	// OpenShift ↔ ZeroTier
	"How do I list OpenShift pods and check if their host nodes are reachable via ZeroTier?",

	// OpenShift ↔ Proxmox
	"How do I compare OpenShift persistent volume claim usage with Proxmox storage pool content?",

	// OpenShift ↔ Darktrace
	"How do I list OpenShift routes and check whether the backing service IPs appear in Darktrace?",

	// =========================================================================
	// Three-or-more-API chained questions
	// =========================================================================

	"How do I find a Darktrace-flagged device, check its Armis risk score, and look up its registered owners in Microsoft Graph?",
	"How do I list Proxmox VMs, check their ZeroTier membership, and verify each VM is registered as a device in Microsoft Graph?",
	"How do I detect a Darktrace model breach, find the device in Armis, and block its IP with a MikroTik firewall rule?",
	"How do I get Darktrace AI Analyst incidents, enrich them with Armis asset data, and summarise with Anthropic?",
	"How do I find a UniFi device, check for Darktrace breaches, and look up the registered owners in Microsoft Graph?",
	"How do I list ZeroTier network members, resolve their IPs against MikroTik DHCP leases, and check for Darktrace activity?",
	"How do I identify a high-risk Armis asset, check its Darktrace breach history, and verify its Microsoft Graph device registration?",
	"How do I audit Proxmox VMs, cross-reference their hostnames against Microsoft Graph devices, then check each VM's ZeroTier reachability?",
	"How do I pull UniFi connected clients, look up each in Armis for risk, and flag suspicious ones in Darktrace?",
	"How do I find a MikroTik firewall rule blocking traffic, trace the source device in Darktrace, and check its Armis profile and Microsoft Graph device registration?",
	"How do I get MikroTik interface traffic stats, identify top talkers in Darktrace, and look up their Armis asset profiles?",
	"How do I audit UniFi clients, cross-reference with Armis risk scores, and check for Darktrace model breaches?",
	"How do I list OpenShift KubeVirt VMs, match them to Proxmox VMs by name, and check ZeroTier connectivity for each?",
	"How do I pull Darktrace model breaches, enrich each with Armis device data, classify severity with OpenAI, and confirm device registration in Microsoft Graph?",
	"How do I inventory UniFi site devices, check each for Darktrace alerts, look up Armis risk scores, and generate a report with Anthropic?",
	"How do I list ZeroTier members, resolve their IPs via MikroTik ARP, and check each device's status in both Darktrace and Armis?",
];
