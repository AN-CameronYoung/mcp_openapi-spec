# openapi-chroma

OpenAPI spec ingestion into ChromaDB with an MCP server for Claude. Ingest any OpenAPI v2/v3 spec and search it semantically via MCP tools.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp .env.example .env  # edit as needed
```

### Ingest a spec

```bash
python main.py ingest ./specs/zerotier.yaml --api zerotier
python main.py ingest https://example.com/openapi.yaml --api myapi
```

### Run the MCP server

```bash
# stdio (local Claude Code subprocess)
python main.py serve

# HTTP (remote / homelab)
python main.py serve --transport http --port 3000
```

### Other CLI commands

```bash
python main.py list          # list all ingested APIs
python main.py query "list all devices" --api proxmox
```

## MCP tools

| Tool | Description | Role |
|------|-------------|------|
| `search_endpoints` | Semantic search over API endpoints | read |
| `search_schemas` | Semantic search over data schemas | read |
| `get_endpoint` | Exact lookup by path + HTTP method | read |
| `list_apis` | List all ingested API names | read |
| `ingest_spec` | Ingest a spec from file or URL at runtime | admin |
| `delete_api` | Remove all documents for an API | admin |

## MCP client config

### stdio (local)

```json
{
  "mcpServers": {
    "openapi": {
      "command": "python",
      "args": ["/path/to/main.py", "serve"]
    }
  }
}
```

### HTTP (remote)

```json
{
  "mcpServers": {
    "openapi": {
      "type": "http",
      "url": "http://your-server:3000/openapi/"
    }
  }
}
```

If auth is enabled, add the token header:

```json
{
  "mcpServers": {
    "openapi": {
      "type": "http",
      "url": "http://your-server:3000/openapi/",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

## Swagger UI

When running in HTTP mode, the server serves Swagger UI for browsing your ingested API specs.

| URL | Description |
|-----|-------------|
| `/openapi/docs` | Swagger UI with a dropdown to select any spec |
| `/openapi/specs/<filename>` | Raw spec files (YAML/JSON) |
| `/openapi/` | MCP endpoint |

Specs are auto-discovered from the `specs/` directory. Drop a new `.yaml` or `.json` file in there and it appears in the dropdown immediately.

Large specs (>10 MB) are labeled with a warning in the dropdown -- Swagger UI parses the entire spec client-side and files like the MS Graph spec (60+ MB) will freeze the browser.

## Authentication

Auth is controlled by two environment variables:

| Variable | Description |
|----------|-------------|
| `MCP_ADMIN_TOKEN` | Full access -- all MCP tools including `ingest_spec` and `delete_api` |
| `MCP_READ_TOKEN` | Read-only -- `search_endpoints`, `search_schemas`, `get_endpoint`, `list_apis`, plus Swagger UI and spec files |

If neither is set, auth is **disabled** and all endpoints are open (for local dev only).

### Setup

Generate tokens:

```bash
export MCP_ADMIN_TOKEN=$(openssl rand -hex 32)
export MCP_READ_TOKEN=$(openssl rand -hex 32)
```

Or add them to `.env`:

```
MCP_ADMIN_TOKEN=your-admin-token-here
MCP_READ_TOKEN=your-read-token-here
```

For the systemd service, add to the unit file:

```ini
Environment=MCP_ADMIN_TOKEN=your-admin-token-here
Environment=MCP_READ_TOKEN=your-read-token-here
```

### Behavior

| Request | No token | Read token | Admin token |
|---------|----------|------------|-------------|
| `GET /openapi/docs` | 401 | 200 | 200 |
| `GET /openapi/specs/*` | 401 | 200 | 200 |
| MCP `list_apis` | 401 | 200 | 200 |
| MCP `search_endpoints` | 401 | 200 | 200 |
| MCP `ingest_spec` | 401 | **403** | 200 |
| MCP `delete_api` | 401 | **403** | 200 |

When auth is disabled (no tokens set), all requests are allowed.

## Scripts

### Reconstruct spec from ChromaDB

Rebuild an OpenAPI YAML from data already ingested in ChromaDB:

```bash
# From ChromaDB directly (needs access to the DB)
python scripts/reconstruct_spec.py darktrace

# From a text dump (e.g. saved MCP search output)
python scripts/reconstruct_spec.py darktrace -f /tmp/endpoints.txt -o specs/darktrace.yaml
```

### Postman collection to OpenAPI

Convert a Postman Collection v2.1 export to OpenAPI 3.0:

```bash
python scripts/postman_to_openapi.py collection.json -o specs/myapi.yaml --title "My API"
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROMA_HOST` | *(unset)* | Remote ChromaDB host. If unset, uses local persistent storage. |
| `CHROMA_PORT` | `8000` | Port for remote ChromaDB |
| `CHROMA_SSL` | `false` | Enable SSL for remote ChromaDB |
| `CHROMA_AUTH_TOKEN` | *(unset)* | Bearer token for remote ChromaDB |
| `CHROMA_DB_PATH` | `.chroma_db` | Local persistent DB path |
| `CHROMA_COLLECTION` | `openapi_specs` | ChromaDB collection name |
| `OLLAMA_URL` | *(unset)* | Ollama server URL for embeddings. If unset, uses sentence-transformers locally. |
| `OLLAMA_MODEL` | `mxbai-embed-large` | Ollama embedding model |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | sentence-transformers model (only if `OLLAMA_URL` is unset) |
| `MCP_ADMIN_TOKEN` | *(unset)* | Admin auth token (full access) |
| `MCP_READ_TOKEN` | *(unset)* | Read-only auth token |
