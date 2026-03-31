"""
OpenAPI v2/v3 parser. Loads a spec from a file path or URL, resolves all
$ref pointers, and extracts a flat list of endpoint and schema dicts.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import jsonref
import yaml


def load_spec(source: str) -> dict:
    """Load an OpenAPI spec from a file path or HTTP(S) URL.

    Returns the fully $ref-resolved spec as a plain dict.
    """
    if source.startswith("http://") or source.startswith("https://"):
        response = httpx.get(source, follow_redirects=True, timeout=30)
        response.raise_for_status()
        raw = response.text
        if source.endswith(".json") or response.headers.get("content-type", "").startswith("application/json"):
            data = json.loads(raw)
        else:
            data = yaml.safe_load(raw)
    else:
        path = Path(source)
        raw = path.read_text(encoding="utf-8")
        if path.suffix in (".json",):
            data = json.loads(raw)
        else:
            data = yaml.safe_load(raw)

    # Resolve all $ref pointers so downstream code works with plain dicts
    return jsonref.replace_refs(data, proxies=False)


def extract_endpoints(spec: dict) -> list[dict]:
    """Return a list of endpoint dicts from a resolved spec.

    Each dict has keys:
        method, path, operation_id, summary, description, tags,
        parameters, request_body, responses
    """
    endpoints: list[dict] = []
    paths = spec.get("paths", {})

    for path, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        # Parameters defined at the path level (inherited by all operations)
        path_level_params = path_item.get("parameters", [])

        for method in ("get", "post", "put", "patch", "delete", "head", "options", "trace"):
            operation = path_item.get(method)
            if not isinstance(operation, dict):
                continue

            # Merge path-level params with operation-level params; op-level wins
            op_params = operation.get("parameters", [])
            merged_params = _merge_parameters(path_level_params, op_params)

            endpoints.append({
                "method": method.upper(),
                "path": path,
                "operation_id": operation.get("operationId", ""),
                "summary": operation.get("summary", ""),
                "description": operation.get("description", ""),
                "tags": operation.get("tags", []),
                "parameters": merged_params,
                "request_body": operation.get("requestBody"),
                "responses": operation.get("responses", {}),
            })

    return endpoints


def extract_schemas(spec: dict) -> list[dict]:
    """Return a list of schema dicts from the components/definitions section.

    Each dict has keys: name, description, properties, required, schema_type, enum
    """
    schemas: list[dict] = []

    # OpenAPI v3: components.schemas
    # OpenAPI v2: definitions
    raw_schemas: dict[str, Any] = {}
    if "components" in spec:
        raw_schemas = spec["components"].get("schemas", {})
    elif "definitions" in spec:
        raw_schemas = spec.get("definitions", {})

    for name, schema in raw_schemas.items():
        if not isinstance(schema, dict):
            continue
        schemas.append({
            "name": name,
            "description": schema.get("description", ""),
            "properties": schema.get("properties", {}),
            "required": schema.get("required", []),
            "schema_type": schema.get("type", "object"),
            "enum": schema.get("enum"),
        })

    return schemas


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _merge_parameters(path_params: list, op_params: list) -> list:
    """Merge path-level and operation-level parameters, op-level takes precedence."""
    merged: dict[tuple, dict] = {}
    for p in path_params:
        if isinstance(p, dict):
            key = (p.get("in", ""), p.get("name", ""))
            merged[key] = p
    for p in op_params:
        if isinstance(p, dict):
            key = (p.get("in", ""), p.get("name", ""))
            merged[key] = p
    return list(merged.values())
