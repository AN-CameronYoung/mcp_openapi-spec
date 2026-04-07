#!/usr/bin/env python3
"""
Split the MS Graph Devices specs into domain-grouped sub-specs.
Each output is a valid OpenAPI 3.x spec with only relevant paths + components.

Usage: python3 scripts/split_msgraph_devices.py
Output: specs/msgraph-devices-{chunk}.yaml, specs/msgraph-devices-beta-{chunk}.yaml
"""

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML required: pip install pyyaml")
    sys.exit(1)

SPECS_DIR = Path("specs")

INPUTS = [
    ("msgraph-devices", SPECS_DIR / "msgraph-devices.yaml"),
    ("msgraph-devices-beta", SPECS_DIR / "msgraph-devices-beta.yaml"),
]

# Chunk definitions: (suffix, set of sub-resource path segments to match)
# A path like /devices/{device-id}/memberOf/... matches "memberOf"
# Paths with no sub-resource (e.g. /devices, /devices/$count) go to "core"
CHUNKS = [
    ("core", {"extensions", "commands", "deviceTemplate", "usageRights",
              "checkMemberGroups", "checkMemberObjects", "getMemberGroups",
              "getMemberObjects", "restore"}),
    ("membership", {"memberOf", "transitiveMemberOf"}),
    ("ownership", {"registeredOwners", "registeredUsers"}),
]


def sub_resource(path: str) -> str | None:
    """Extract the sub-resource segment from /devices/{device-id}/{sub}/..."""
    m = re.match(r"^/devices/\{[^}]+\}/([^/${\[]+)", path)
    return m.group(1) if m else None


def collect_refs(obj, found: set):
    """Recursively find all $ref values pointing to #/components/..."""
    if isinstance(obj, dict):
        ref = obj.get("$ref", "")
        if isinstance(ref, str) and ref.startswith("#/components/"):
            # e.g. #/components/schemas/Foo → ("schemas", "Foo")
            parts = ref.split("/")
            if len(parts) >= 4:
                found.add((parts[2], parts[3]))
        for v in obj.values():
            collect_refs(v, found)
    elif isinstance(obj, list):
        for item in obj:
            collect_refs(item, found)


def resolve_components(needed: set, all_components: dict) -> dict:
    """Pull in component entries transitively."""
    resolved: dict[str, dict] = {}
    queue = list(needed)
    while queue:
        section, name = queue.pop()
        key = (section, name)
        if key in resolved:
            continue
        section_dict = all_components.get(section, {})
        if name not in section_dict:
            continue
        resolved[key] = section_dict[name]
        extra: set = set()
        collect_refs(section_dict[name], extra)
        queue.extend(extra - resolved.keys())
    # Rebuild into nested dict
    result: dict[str, dict] = {}
    for (section, name), value in resolved.items():
        result.setdefault(section, {})[name] = value
    return result


def split_spec(base_name: str, input_path: Path):
    print(f"\nLoading {input_path} ...")
    with open(input_path) as f:
        spec = yaml.safe_load(f)

    all_paths = spec.get("paths", {})
    all_components = spec.get("components", {})

    # Also resolve refs from top-level parameters/responses
    top_level_refs: set = set()
    for section in ("parameters", "responses", "requestBodies"):
        if section in all_components:
            collect_refs(all_components[section], top_level_refs)

    # Build sub-resource → chunk mapping
    sub_to_chunk: dict[str, str] = {}
    for chunk_name, subs in CHUNKS:
        for s in subs:
            sub_to_chunk[s] = chunk_name

    # Assign paths to chunks
    chunk_paths: dict[str, dict] = {name: {} for name, _ in CHUNKS}
    for path, item in all_paths.items():
        sub = sub_resource(path)
        if sub and sub in sub_to_chunk:
            chunk_paths[sub_to_chunk[sub]][path] = item
        else:
            # Top-level /devices paths and actions go to core
            chunk_paths["core"][path] = item

    # Base metadata (everything except paths and components)
    base = {k: v for k, v in spec.items() if k not in ("paths", "components")}

    for chunk_name, _ in CHUNKS:
        paths = chunk_paths.get(chunk_name, {})
        if not paths:
            print(f"  [skip] {base_name}-{chunk_name}: no paths")
            continue

        # Collect all $refs from paths, then resolve transitively
        needed: set = set()
        collect_refs(paths, needed)

        components = resolve_components(needed, all_components)

        out_spec = {**base}
        # Update title to reflect the chunk
        if "info" in out_spec:
            out_spec["info"] = {**out_spec["info"],
                                "title": f"{out_spec['info'].get('title', base_name)} — {chunk_name}"}
        out_spec["paths"] = paths
        if components:
            out_spec["components"] = components

        out_path = SPECS_DIR / f"{base_name}-{chunk_name}.yaml"
        with open(out_path, "w") as f:
            yaml.dump(out_spec, f, default_flow_style=False, allow_unicode=True, sort_keys=False, width=200)

        size_kb = out_path.stat().st_size // 1024
        print(f"  {out_path.name}: {len(paths)} paths, {len(components.get('schemas', {}))} schemas, {size_kb} KB")


def main():
    for base_name, input_path in INPUTS:
        if not input_path.exists():
            print(f"  [skip] {input_path} not found")
            continue
        split_spec(base_name, input_path)

    print("\nDone.")


if __name__ == "__main__":
    main()
