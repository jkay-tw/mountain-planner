#!/usr/bin/env python3
"""Gate coordinate updates, regenerate affected geometry, and publish safely.

The owner-reviewed route catalogue and owner coordinate overrides are inputs.
Only the existing terrain updater may compute route spans/DEM; NEVER patch
geometry coordinates alone because GPX, profiles and elevation would go stale.
By default this tool is read-only. Preview publication never touches the live
data/geometry runtime or production app assets.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OVERRIDES = ROOT / "data/geometry/sources/owner-coordinate-overrides.json"
OFFICIAL = ROOT / "data/geometry/planner-terrain-v1.json"
PREVIEW = ROOT / "preview/data/geometry/planner-terrain-v1.json"
CORRECTIONS = ROOT / "data/geometry/sources/owner-update-source-corrections.json"
CLIPS = ROOT / "data/geometry/sources/owner-update-reference-clips.json"
PREVIEW_JS = ROOT / "preview/js/unified-editor.js"
PREVIEW_HTML = ROOT / "preview/unified-editor.html"
PRODUCTION_JS = ROOT / "js/unified-editor.js"
PRODUCTION_HTML = ROOT / "index.html"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def manifest_catalog(root=None):
    root = Path(root) if root is not None else ROOT
    manifest = load(root / "data/unified-editor-manifest.json")
    nodes, edges, manual = {}, {}, {}
    for entry in manifest["routes"]:
        relative = entry["file"].split("?")[0]
        route = load(root / relative)
        nodes.update({n["id"]: n for n in route["nodes"]})
        for e in route["segments"]:
            if e.get("travelMode", "walking") == "walking" and e.get("routingEnabled", True):
                edges[(e["fromId"], e["toId"])] = e
        for e in route.get("manualConnections", []):
            manual[(e["fromId"], e["toId"])] = e
    return nodes, edges, manual


def input_fingerprint():
    review = load(OVERRIDES)
    nodes, edges, manual = manifest_catalog()
    # Route JSON defines topology/identity, but coordinates are reviewed
    # through the canonical overrides. Do not silently accept a direct
    # route-node coordinate that the existing geometry updater would ignore.
    reviews_by_id = {r["nodeId"]: r for r in review.get("nodes", [])}
    for node in nodes.values():
        direct = node.get("coordinate")
        if direct is not None:
            approved = reviews_by_id.get(node["id"], {})
            if approved.get("action") != "coordinate" or approved.get("coordinate") != direct:
                raise ValueError(
                    "Direct route-node coordinate is not in owner-coordinate-overrides.json: "
                    + node["id"]
                )
    corrections = load(CORRECTIONS) if CORRECTIONS.exists() else {"nodes": []}
    clips = load(CLIPS) if CLIPS.exists() else {"routes": []}
    # Identical ordering, separators, and content to update_planner_terrain.py.
    payload = [review, nodes, list(edges.items()), list(manual.items()), corrections, clips]
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return digest, review, nodes


def preview_catalog_matches():
    """The existing updater uses the root manifest. Refuse mismatched Preview inputs."""
    root = ROOT / "data/unified-editor-manifest.json"
    preview = ROOT / "preview/data/unified-editor-manifest.json"
    if root.read_bytes() != preview.read_bytes():
        raise ValueError("Preview manifest differs from root: regenerate with the matching catalogue first")
    for entry in load(root)["routes"]:
        name = entry["file"].split("?")[0]
        if (ROOT / name).read_bytes() != (ROOT / "preview" / name).read_bytes():
            raise ValueError("Preview route file differs from root: " + name)


def verify_runtime(path, expected, review, catalog_nodes):
    data = load(path)
    if data.get("ownerUpdateInputFingerprint") != expected:
        raise ValueError(
            str(path.relative_to(ROOT)) + " has stale coordinate/topology inputs. "
            "Regenerate from source OSM network and DEM before publication."
        )
    by_id = {n["nodeId"]: n for n in data.get("nodes", [])}
    if set(by_id) != set(catalog_nodes):
        raise ValueError("Node-ID set differs between reviewed catalogue and runtime")
    for record in review.get("nodes", []):
        node_id, action = record["nodeId"], record["action"]
        node = by_id.get(node_id)
        if node is None:
            # A retired node is deliberately omitted from published topology.
            if node_id in catalog_nodes:
                raise ValueError("Active node missing from runtime: " + node_id)
            continue
        if action == "ignore" and node.get("coordinatePolicy") != "ignored":
            raise ValueError("Ignored node still active: " + node_id)
        if action == "coordinate" and node.get("coordinatePolicy") == "active":
            if node.get("coordinate") != record.get("coordinate"):
                raise ValueError("User-confirmed coordinate not applied: " + node_id)
    return data


def atomic_copy(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.read_bytes() == dst.read_bytes() if dst.exists() else False:
        return False
    temp = dst.with_name(dst.name + ".incoming")
    shutil.copyfile(src, temp)
    temp.replace(dst)
    return True


def canonical_bytes(path):
    """Git stores these text assets as LF, even with a Windows CRLF checkout."""
    return path.read_bytes().replace(b"\r\n", b"\n")


def verify_cache(js_path, html_path, geometry_path):
    data_sha = hashlib.sha256(canonical_bytes(geometry_path)).hexdigest()[:12]
    if "data/geometry/planner-terrain-v1.json?v=geo" + data_sha not in js_path.read_text(encoding="utf-8"):
        raise ValueError("Geometry cache URL is stale: " + str(js_path))
    script_sha = hashlib.sha256(canonical_bytes(js_path)).hexdigest()[:12]
    if "js/unified-editor.js?v=geo" + script_sha not in html_path.read_text(encoding="utf-8"):
        raise ValueError("HTML script cache URL is stale: " + str(html_path))


def refresh_cache(js_path, html_path, geometry_path):
    """Data SHA drives the fetch query; app SHA drives the HTML module query."""
    digest = hashlib.sha256(canonical_bytes(geometry_path)).hexdigest()[:12]
    js = js_path.read_text(encoding="utf-8")
    find = r"data/geometry/planner-terrain-v1\.json\?v=[A-Za-z0-9_.-]+"
    ref = "data/geometry/planner-terrain-v1.json?v=geo" + digest
    updated, count = re.subn(find, ref, js)
    if count != 1:
        raise ValueError("Expected exactly one terrain fetch URL in " + str(js_path))
    # Never allow an intermediary cache to persist stale coordinates after refresh.
    # Change only the geometry request; manifest requests already use no-store.
    updated = re.sub(
        r"fetch\('data/geometry/planner-terrain-v1\.json\?v=[^']+'\)",
        lambda match: match.group(0)[:-1] + ",{cache:'no-store'})",
        updated,
    )
    if updated != js:
        js_path.write_text(updated, encoding="utf-8")
    script_sha = hashlib.sha256(canonical_bytes(js_path)).hexdigest()[:12]
    html = html_path.read_text(encoding="utf-8")
    # Root production uses js/, Preview uses js/ relative to its own HTML.
    updated_html, count = re.subn(
        r"js/unified-editor\.js\?v=[A-Za-z0-9_.-]+",
        "js/unified-editor.js?v=geo" + script_sha, html,
    )
    if count != 1:
        raise ValueError("Expected exactly one script URL in " + str(html_path))
    if updated_html != html:
        html_path.write_text(updated_html, encoding="utf-8")
    return digest, script_sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_mutually_exclusive_group(required=True)
    commands.add_argument("--check", action="store_true", help="Read-only Preview source/runtime gate")
    commands.add_argument("--sync-preview", action="store_true", help="Copy already-rebuilt official runtime to Preview")
    commands.add_argument("--build-preview", nargs=2, metavar=("OSM_JSON_GZ", "DEM_ZIP"),
                          help="Recompute affected Preview geometry using existing source-aware updater")
    commands.add_argument("--promote-production", action="store_true", help="Copy accepted Preview geometry to production")
    parser.add_argument("--approve-production", action="store_true",
                        help="Explicitly approve production data promotion; never implied")
    args = parser.parse_args()

    fingerprint, review, catalog_nodes = input_fingerprint()
    preview_catalog_matches()
    if args.build_preview:
        with tempfile.TemporaryDirectory(prefix="mountain-coordinate-") as directory:
            staged = Path(directory) / "planner-terrain-v1.json"
            shutil.copyfile(PREVIEW, staged)
            network, dem = map(Path, args.build_preview)
            cmd = [sys.executable, str(ROOT / "tools/update_planner_terrain.py"),
                   str(network), str(dem), "--output", str(staged),
                   "--report", str(Path(directory) / "update-report.json")]
            subprocess.run(cmd, cwd=ROOT, check=True)
            verify_runtime(staged, fingerprint, review, catalog_nodes)
            copied = atomic_copy(staged, PREVIEW)
        v, s = refresh_cache(PREVIEW_JS, PREVIEW_HTML, PREVIEW)
        print(f"Preview geometry built and synchronized (changed={copied}, data={v}, script={s}).")
    elif args.sync_preview:
        verify_runtime(OFFICIAL, fingerprint, review, catalog_nodes)
        copied = atomic_copy(OFFICIAL, PREVIEW)
        v, s = refresh_cache(PREVIEW_JS, PREVIEW_HTML, PREVIEW)
        print(f"Preview geometry synchronized (changed={copied}, data={v}, script={s}).")
    elif args.promote_production:
        if not args.approve_production:
            raise ValueError("Production promotion requires --approve-production after owner acceptance")
        verify_runtime(PREVIEW, fingerprint, review, catalog_nodes)
        copied = atomic_copy(PREVIEW, OFFICIAL)
        v, s = refresh_cache(PRODUCTION_JS, PRODUCTION_HTML, OFFICIAL)
        print(f"Production geometry promoted (changed={copied}, data={v}, script={s}).")
    else:
        verify_runtime(PREVIEW, fingerprint, review, catalog_nodes)
        verify_cache(PREVIEW_JS, PREVIEW_HTML, PREVIEW)
        if canonical_bytes(OFFICIAL) == canonical_bytes(PREVIEW):
            verify_cache(PRODUCTION_JS, PRODUCTION_HTML, OFFICIAL)
        print("Preview geometry is current with reviewed route/coordinate sources.")
    print("No node-ID merging, unverified routing or fabricated GPX spans were performed.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError, subprocess.CalledProcessError) as error:
        sys.exit("Coordinate sync gate FAILED: " + str(error))
