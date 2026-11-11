"""Offline tests for source fingerprint and safe release/cache behavior."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import sync_coordinate_geometry as sync


class CoordinateSyncTests(unittest.TestCase):
    def test_input_fingerprint_uses_the_existing_updater_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data/routes/owner-reviewed").mkdir(parents=True)
            (root / "data/geometry/sources").mkdir(parents=True)
            manifest = {"routes": [{"file": "data/routes/owner-reviewed/G99.json?v=1"}]}
            route = {"nodes": [{"id": "node-a", "name": "A"}],
                     "segments": [{"fromId": "node-a", "toId": "node-a", "minutes": 5}],
                     "manualConnections": []}
            review = {"nodes": [{"nodeId": "node-a", "action": "pending"}]}
            for name, value in [
                ("data/unified-editor-manifest.json", manifest),
                ("data/routes/owner-reviewed/G99.json", route),
                ("data/geometry/sources/owner-coordinate-overrides.json", review),
            ]:
                path = root / name
                path.write_text(json.dumps(value), encoding="utf-8")
            with patch.object(sync, "ROOT", root), patch.object(sync, "OVERRIDES", root / "data/geometry/sources/owner-coordinate-overrides.json"), patch.object(sync, "CORRECTIONS", root / "missing-corrections"), patch.object(sync, "CLIPS", root / "missing-clips"):
                digest, result_review, nodes = sync.input_fingerprint()
                self.assertEqual(result_review, review)
                self.assertEqual(set(nodes), {"node-a"})
                self.assertEqual(len(digest), 64)
                self.assertEqual(digest, sync.input_fingerprint()[0])

    def test_verify_detects_stale_inputs_and_coordinate_disagreement(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "terrain.json"
            catalog = {"a": {"id": "a"}}
            review = {"nodes": [{"nodeId": "a", "action": "coordinate", "coordinate": [121.1, 24.1]}]}
            data = {"ownerUpdateInputFingerprint": "current", "nodes": [
                {"nodeId": "a", "coordinatePolicy": "active", "coordinate": [121.1, 24.1]}
            ]}
            runtime.write_text(json.dumps(data), encoding="utf-8")
            with patch.object(sync, "ROOT", Path(directory)):
                self.assertEqual(sync.verify_runtime(runtime, "current", review, catalog), data)
                with self.assertRaisesRegex(ValueError, "stale"):
                    sync.verify_runtime(runtime, "new", review, catalog)
                data["nodes"][0]["coordinate"] = [121.2, 24.1]
                runtime.write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "not applied"):
                    sync.verify_runtime(runtime, "current", review, catalog)

    def test_cache_sync_updates_only_geometry_fetch_and_html_module(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "js").mkdir()
            script = base / "js/unified-editor.js"
            html = base / "unified-editor.html"
            geometry = base / "terrain.json"
            geometry.write_text('{"nodes":[]}', encoding="utf-8")
            script.write_text("await fetch('data/unified-editor-manifest.json',{cache:'no-store'});\n"
                              "await fetch('data/geometry/planner-terrain-v1.json?v=v084');\n",
                              encoding="utf-8")
            html.write_text('<script src="js/unified-editor.js?v=old1"></script>', encoding="utf-8")
            digest, script_digest = sync.refresh_cache(script, html, geometry)
            self.assertEqual(len(digest), 12)
            self.assertEqual(len(script_digest), 12)
            self.assertIn("v=geo" + digest, script.read_text(encoding="utf-8"))
            self.assertIn("v=geo" + script_digest, html.read_text(encoding="utf-8"))
            self.assertIn("planner-terrain-v1.json?v=geo" + digest + "',{cache:'no-store'}",
                          script.read_text(encoding="utf-8"))
            self.assertEqual(script.read_text(encoding="utf-8").count("{cache:'no-store'}"), 2)
            original = script.read_bytes()
            sync.refresh_cache(script, html, geometry)
            self.assertEqual(script.read_bytes(), original)

    def test_preview_copy_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            src, dst = Path(directory) / "src.json", Path(directory) / "preview.json"
            src.write_text('{"nodes":[]}', encoding="utf-8")
            self.assertTrue(sync.atomic_copy(src, dst))
            self.assertFalse(sync.atomic_copy(src, dst))

    def test_cache_fingerprints_match_git_lf_for_windows_and_linux(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            results = []
            for index, newline in enumerate((b'\n', b'\r\n')):
                folder = base / str(index)
                folder.mkdir()
                geometry, script, html = (folder / p for p in ('data.json', 'app.js', 'index.html'))
                geometry.write_bytes(b'{"nodes":[]}' + newline)
                script.write_bytes(b"await fetch('data/geometry/planner-terrain-v1.json?v=old');" + newline)
                html.write_bytes(b'<script src="js/unified-editor.js?v=old"></script>' + newline)
                results.append(sync.refresh_cache(script, html, geometry))
                sync.verify_cache(script, html, geometry)
                # Simulate Git checkout in CI: normalize every asset to LF.
                for path in (geometry, script, html):
                    path.write_bytes(sync.canonical_bytes(path))
                sync.verify_cache(script, html, geometry)
            self.assertEqual(results[0], results[1])

    def test_guard_rejects_module_edit_after_cache_refresh(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            geometry, script, html = (base / p for p in ('data.json', 'app.js', 'index.html'))
            geometry.write_bytes(b'{"nodes":[]}\n')
            script.write_bytes(b"await fetch('data/geometry/planner-terrain-v1.json?v=old');\n")
            html.write_bytes(b'<script src="js/unified-editor.js?v=old"></script>\n')
            sync.refresh_cache(script, html, geometry)
            script.write_bytes(script.read_bytes() + b'// edited dependency version\n')
            with self.assertRaisesRegex(ValueError, 'HTML script cache URL is stale'):
                sync.verify_cache(script, html, geometry)
            sync.refresh_cache(script, html, geometry)
            sync.verify_cache(script, html, geometry)


if __name__ == "__main__":
    unittest.main()
