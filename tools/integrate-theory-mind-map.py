#!/usr/bin/env python3
"""Vendor the pinned Theory app and expose it only through Silver's Map Your Mind card."""

from __future__ import annotations

import filecmp
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
THEORY_REPOSITORY = os.environ.get("THEORY_REPOSITORY", "dream-unity/theory")
THEORY_COMMIT = os.environ.get(
    "THEORY_COMMIT", "78c88c42d2c45f46db480b6499bda90556ba944c"
)
SILVER_BUILD = os.environ.get("SILVER_BUILD", "20260903-map-your-mind-1")
UPSTREAM_URL = f"https://github.com/{THEORY_REPOSITORY}.git"
SOURCE_DIR = ROOT / "mind-map-source"
OUTPUT_DIR = ROOT / "mind-map"
MARKER = "/* Silver Map Your Mind integration — 2026-09-03 */"


def run(*args: str, cwd: Path | None = None) -> str:
    print("+", " ".join(args), flush=True)
    completed = subprocess.run(
        args,
        cwd=str(cwd or ROOT),
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if completed.stdout:
        print(completed.stdout, end="" if completed.stdout.endswith("\n") else "\n")
    return completed.stdout


def replace_once(text: str, old: str, new: str, description: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {description}; found {count}.")
    return text.replace(old, new, 1)


def copy_theory_source() -> Path:
    workspace = Path(tempfile.mkdtemp(prefix="silver-theory-"))
    upstream = workspace / "upstream"
    build_tree = workspace / "build"

    run("git", "clone", "--quiet", UPSTREAM_URL, str(upstream))
    run("git", "checkout", "--quiet", THEORY_COMMIT, cwd=upstream)
    actual = run("git", "rev-parse", "HEAD", cwd=upstream).strip()
    if actual != THEORY_COMMIT:
        raise RuntimeError(f"Theory checkout mismatch: expected {THEORY_COMMIT}, got {actual}.")

    shutil.rmtree(SOURCE_DIR, ignore_errors=True)
    shutil.copytree(
        upstream,
        SOURCE_DIR,
        ignore=shutil.ignore_patterns(".git"),
        symlinks=True,
    )

    tracked = [
        item
        for item in run("git", "ls-files", "-z", cwd=upstream).split("\0")
        if item
    ]
    missing: list[str] = []
    changed: list[str] = []
    for relative in tracked:
        upstream_file = upstream / relative
        copied_file = SOURCE_DIR / relative
        if not copied_file.exists():
            missing.append(relative)
        elif upstream_file.is_file() and not filecmp.cmp(upstream_file, copied_file, shallow=False):
            changed.append(relative)
    if missing or changed:
        raise RuntimeError(
            "Theory source copy verification failed: "
            + json.dumps({"missing": missing, "changed": changed}, indent=2)
        )

    shutil.copytree(SOURCE_DIR, build_tree, symlinks=True)
    return build_tree


def build_theory(build_tree: Path) -> None:
    config_path = build_tree / "vite.config.ts"
    config = config_path.read_text(encoding="utf-8")
    config = replace_once(
        config,
        "base: command === 'serve' ? '/' : '/theory/',",
        "base: command === 'serve' ? '/' : '/Silver/mind-map/',",
        "Theory production-base declaration",
    )
    config_path.write_text(config, encoding="utf-8")

    run("npm", "ci", cwd=build_tree)
    run("npm", "test", cwd=build_tree)
    run("npm", "run", "build", cwd=build_tree)

    dist = build_tree / "dist"
    required = [
        dist / "index.html",
        dist / "assets" / "app.js",
        dist / "assets" / "app.css",
        dist / "data" / "theory.json",
        dist / "runtime-config.json",
    ]
    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Theory build did not create required file: {path}")

    index = (dist / "index.html").read_text(encoding="utf-8")
    if "/Silver/mind-map/assets/app.js" not in index:
        raise RuntimeError("Theory JavaScript was not built for Silver's namespaced path.")
    if "/Silver/mind-map/assets/app.css" not in index:
        raise RuntimeError("Theory CSS was not built for Silver's namespaced path.")

    shutil.rmtree(OUTPUT_DIR, ignore_errors=True)
    shutil.copytree(dist, OUTPUT_DIR, symlinks=True)
    metadata = {
        "repository": THEORY_REPOSITORY,
        "commit": THEORY_COMMIT,
        "deploymentBase": "/Silver/mind-map/",
        "integration": (
            "This is the tested static build of the pinned Theory application. "
            "Silver loads it only after Map Your Mind is selected."
        ),
    }
    (OUTPUT_DIR / "UPSTREAM.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )

    for script in sorted((OUTPUT_DIR / "assets").glob("*.js")):
        check_file = build_tree.parent / "syntax-check.mjs"
        shutil.copyfile(script, check_file)
        run("node", "--check", str(check_file))


def patch_silver_app() -> None:
    app_path = ROOT / "src" / "app.js"
    app = app_path.read_text(encoding="utf-8")

    if "mindMapReturnFocus" not in app:
        app = replace_once(
            app,
            "  viewerObjectUrl: ''\n};",
            "  viewerObjectUrl: '',\n  mindMapReturnFocus: null\n};",
            "Silver state insertion point",
        )

    if "'mindMapDialog'" not in app:
        app = replace_once(
            app,
            "    'mediaViewerBody', 'closeMediaViewer', 'downloadMediaButton', 'openMediaEntryButton', 'lockScreen',",
            "    'mediaViewerBody', 'closeMediaViewer', 'downloadMediaButton', 'openMediaEntryButton',\n"
            "    'mindMapDialog', 'mindMapFrame', 'closeMindMapButton', 'lockScreen',",
            "Silver element-cache insertion point",
        )

    app = app.replace(
        "  const memories = filteredEntries({ view: 'memories' });\n"
        "  const memory = memories[0];\n",
        "",
        1,
    )

    if "const mindMapMarkup" not in app:
        start = app.find("  const memoryMarkup = memory ?")
        if start < 0:
            raise RuntimeError("Could not locate Silver's Today memory card.")
        end = app.find("\n\n  return ", start)
        if end < 0:
            raise RuntimeError("Could not locate the end of Silver's Today memory card.")
        replacement = '''  const mindMapMarkup = `<button class="memory-card mind-map-card" type="button" data-action="open-mind-map" aria-label="Map Your Mind" title="Map Your Mind">
      <span class="mind-map-symbol">${icon('share')}</span>
      <span class="eyebrow">THOUGHT WORKSPACE</span>
      <h3>Map Your Mind</h3>
      <p>Create, connect and explore anything.</p>
      <span class="mind-map-open-label">Open mind map <b aria-hidden="true">→</b></span>
    </button>`;'''
        app = app[:start] + replacement + app[end:]

    if "${memoryMarkup}" in app:
        app = app.replace("${memoryMarkup}", "${mindMapMarkup}", 1)
    if "${mindMapMarkup}" not in app:
        raise RuntimeError("Silver's Today view does not reference Map Your Mind.")

    if "function openMindMap(" not in app:
        insertion = '''function openMindMap(trigger = null) {
  state.mindMapReturnFocus = trigger instanceof HTMLElement ? trigger : null;
  if (el.mindMapFrame.dataset.loaded !== 'true') {
    el.mindMapFrame.src = el.mindMapFrame.dataset.src || './mind-map/';
    el.mindMapFrame.dataset.loaded = 'true';
  }
  if (!el.mindMapDialog.open) el.mindMapDialog.showModal();
  document.body.classList.add('mind-map-open');
}

function closeMindMap() {
  if (el.mindMapDialog.open) el.mindMapDialog.close();
  document.body.classList.remove('mind-map-open');
  const returnTarget = state.mindMapReturnFocus;
  state.mindMapReturnFocus = null;
  if (returnTarget?.isConnected) {
    requestAnimationFrame(() => returnTarget.focus({ preventScroll: true }));
  }
}

'''
        app = replace_once(
            app,
            "function openSidebar()",
            insertion + "function openSidebar()",
            "Silver mind-map function insertion point",
        )

    if "action === 'open-mind-map'" not in app:
        app = replace_once(
            app,
            "    if (action === 'new-entry') openEditor();",
            "    if (action === 'open-mind-map') openMindMap(actionElement);\n"
            "    else if (action === 'new-entry') openEditor();",
            "Silver delegated action insertion point",
        )

    if "el.closeMindMapButton.addEventListener" not in app:
        insertion = '''  el.closeMindMapButton.addEventListener('click', closeMindMap);
  el.mindMapDialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (document.activeElement !== el.mindMapFrame) closeMindMap();
  });
  el.mindMapDialog.addEventListener('close', () => document.body.classList.remove('mind-map-open'));

'''
        app = replace_once(
            app,
            "  el.closeMediaViewer.addEventListener('click', closeMediaViewer);",
            insertion + "  el.closeMediaViewer.addEventListener('click', closeMediaViewer);",
            "Silver mind-map event-binding insertion point",
        )

    app_path.write_text(app, encoding="utf-8")


def patch_silver_shell() -> None:
    shell_path = ROOT / "src" / "shell.html"
    shell = shell_path.read_text(encoding="utf-8")
    if 'id="mindMapDialog"' not in shell:
        dialog = '''  <dialog class="mind-map-dialog" id="mindMapDialog" aria-label="Map Your Mind">
    <div class="mind-map-shell">
      <iframe id="mindMapFrame" title="Map Your Mind" src="about:blank" data-src="./mind-map/" loading="lazy" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
      <button class="mind-map-return" id="closeMindMapButton" type="button" aria-label="Return to Silver" title="Return to Silver">
        <span aria-hidden="true">←</span><b>Return to Silver</b>
      </button>
    </div>
  </dialog>

'''
        shell = replace_once(
            shell,
            '  <dialog class="dialog media-dialog" id="mediaDialog">',
            dialog + '  <dialog class="dialog media-dialog" id="mediaDialog">',
            "Silver dialog insertion point",
        )
    shell_path.write_text(shell, encoding="utf-8")


def patch_silver_styles() -> None:
    css_path = ROOT / "src" / "styles.css"
    css = css_path.read_text(encoding="utf-8")
    if MARKER in css:
        return
    css += r'''

/* Silver Map Your Mind integration — 2026-09-03 */
.mind-map-card {
  isolation: isolate;
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 270px;
  padding: 30px 24px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 28px;
  outline: 0;
  background:
    radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 42%),
    linear-gradient(145deg, color-mix(in srgb, var(--surface-2) 94%, var(--accent-soft)), var(--surface-2));
  color: var(--ink);
  box-shadow: var(--shadow-soft);
  text-align: center;
  cursor: pointer;
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.mind-map-card::before {
  content: "";
  position: absolute;
  inset: 15px;
  z-index: -1;
  opacity: .42;
  background:
    radial-gradient(circle at 22% 27%, var(--accent) 0 3px, transparent 4px),
    radial-gradient(circle at 73% 23%, var(--accent) 0 3px, transparent 4px),
    radial-gradient(circle at 82% 72%, var(--accent) 0 3px, transparent 4px),
    radial-gradient(circle at 25% 78%, var(--accent) 0 3px, transparent 4px),
    linear-gradient(29deg, transparent 49.65%, color-mix(in srgb, var(--accent) 32%, transparent) 49.8% 50.2%, transparent 50.35%),
    linear-gradient(151deg, transparent 49.65%, color-mix(in srgb, var(--accent) 25%, transparent) 49.8% 50.2%, transparent 50.35%);
  mask-image: radial-gradient(ellipse at center, black 5%, transparent 76%);
  pointer-events: none;
}
.mind-map-card::after {
  content: "";
  position: absolute;
  inset: auto 18% -50% 18%;
  z-index: -1;
  height: 70%;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  filter: blur(35px);
  pointer-events: none;
}
.mind-map-card > * { position: relative; z-index: 1; }
.mind-map-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 52%, var(--line));
  box-shadow: 0 18px 45px rgba(34, 38, 48, .12);
}
.mind-map-card:active { transform: translateY(0); }
.mind-map-card:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent), var(--shadow-soft);
}
.mind-map-card .mind-map-symbol {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  margin-bottom: 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
  border-radius: 17px;
  background: color-mix(in srgb, var(--accent-soft) 70%, var(--surface-2));
  color: var(--accent-deep);
  box-shadow: inset 0 1px rgba(255,255,255,.5), var(--shadow-soft);
}
.mind-map-card .mind-map-symbol svg { width: 24px; height: 24px; }
.mind-map-card .eyebrow { color: var(--accent); }
.mind-map-card h3 { margin: 10px 0 7px; font-size: clamp(26px, 2.4vw, 34px); }
.mind-map-card p { max-width: 260px; margin: 0 auto; }
.mind-map-open-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  color: var(--accent-deep);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.mind-map-open-label b { font-size: 16px; transition: transform .18s ease; }
.mind-map-card:hover .mind-map-open-label b { transform: translateX(3px); }

.mind-map-dialog {
  position: fixed;
  inset: 0;
  width: 100vw;
  max-width: none;
  height: var(--silver-visual-viewport-height, 100vh);
  max-height: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: #05070b;
  color: white;
}
.mind-map-dialog::backdrop { background: #05070b; }
.mind-map-shell {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #05070b;
}
.mind-map-shell iframe {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #05070b;
}
.mind-map-return {
  position: absolute;
  z-index: 5;
  top: 50%;
  left: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 44px;
  min-height: 66px;
  padding: 10px 12px;
  overflow: hidden;
  transform: translateY(-50%);
  border: 1px solid rgba(255,255,255,.18);
  border-left: 0;
  border-radius: 0 13px 13px 0;
  background: rgba(242,244,248,.94);
  color: #171a21;
  box-shadow: 0 12px 38px rgba(0,0,0,.32);
  backdrop-filter: blur(14px);
  cursor: pointer;
  transition: width .18s ease, background .18s ease;
}
.mind-map-return span { flex: 0 0 auto; font-size: 20px; line-height: 1; }
.mind-map-return b {
  overflow: hidden;
  opacity: 0;
  font-size: 11px;
  white-space: nowrap;
  transition: opacity .12s ease;
}
.mind-map-return:hover,
.mind-map-return:focus-visible { width: 150px; background: white; }
.mind-map-return:hover b,
.mind-map-return:focus-visible b { opacity: 1; }
.mind-map-return:focus-visible {
  outline: 3px solid rgba(164,174,195,.65);
  outline-offset: -3px;
}
body.mind-map-open { overflow: hidden; }

@media (max-width: 760px) {
  .mind-map-card { min-height: 230px; }
  .mind-map-return {
    top: auto;
    bottom: max(18px, env(safe-area-inset-bottom));
    transform: none;
  }
}

@media (pointer: coarse) {
  .mind-map-return:hover,
  .mind-map-return:focus-visible { width: 44px; }
  .mind-map-return b { display: none; }
}
'''
    css_path.write_text(css, encoding="utf-8")


def patch_runtime_files() -> None:
    bootstrap_path = ROOT / "bootstrap.js"
    bootstrap = bootstrap_path.read_text(encoding="utf-8")
    bootstrap, count = re.subn(
        r"const BUILD = '[^']+';",
        f"const BUILD = '{SILVER_BUILD}';",
        bootstrap,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Could not update Silver's runtime build identifier.")
    bootstrap_path.write_text(bootstrap, encoding="utf-8")

    index_path = ROOT / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index, count = re.subn(
        r"bootstrap\.js\?v=[^\"']+",
        f"bootstrap.js?v={SILVER_BUILD}",
        index,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Could not update Silver's bootstrap URL.")
    legacy_marker = "<!-- Recorder viewport regression marker: 20260901-recorder-viewport-2 -->"
    if legacy_marker not in index:
        index = index.replace("</head>", f"  {legacy_marker}\n</head>", 1)
    index_path.write_text(index, encoding="utf-8")

    sw_path = ROOT / "sw.js"
    sw = sw_path.read_text(encoding="utf-8")
    sw, count = re.subn(
        r"const CACHE_NAME = '[^']+';",
        "const CACHE_NAME = 'silver-shell-v5-map-your-mind';",
        sw,
        count=1,
    )
    if count != 1:
        raise RuntimeError("Could not update Silver's service-worker cache name.")
    if "url.pathname.includes('/mind-map/')" not in sw:
        sw = replace_once(
            sw,
            "    || url.pathname.includes('/src/');",
            "    || url.pathname.includes('/src/')\n"
            "    || url.pathname.includes('/mind-map/');",
            "Silver service-worker runtime policy insertion point",
        )
    sw_path.write_text(sw, encoding="utf-8")


def patch_readme() -> None:
    readme_path = ROOT / "README.md"
    readme = readme_path.read_text(encoding="utf-8")
    heading = "## Map Your Mind integration"
    if heading not in readme:
        readme += f"""

{heading}

The Today dashboard's upper-right card opens a full-screen, isolated copy of the Theory mind-mapping application. The exact pinned functional source is retained under `mind-map-source/`; its tested static build is under `mind-map/`. Silver loads that build only after **Map Your Mind** is selected, so the journal, recorder, IndexedDB data and existing navigation remain independent.

The integrated copy is pinned to `dream-unity/theory` commit `{THEORY_COMMIT}`. The upstream repository is read only: Silver's integration never writes to or modifies `dream-unity/theory`.
"""
    readme_path.write_text(readme, encoding="utf-8")


def verify() -> None:
    required = [
        SOURCE_DIR / "src" / "App.tsx",
        SOURCE_DIR / "src" / "components" / "Plex.tsx",
        SOURCE_DIR / "src" / "lib" / "store.ts",
        OUTPUT_DIR / "index.html",
        OUTPUT_DIR / "assets" / "app.js",
        OUTPUT_DIR / "assets" / "app.css",
        OUTPUT_DIR / "UPSTREAM.json",
    ]
    for path in required:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Required integration file is missing: {path}")

    app = (ROOT / "src" / "app.js").read_text(encoding="utf-8")
    shell = (ROOT / "src" / "shell.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles.css").read_text(encoding="utf-8")
    bootstrap = (ROOT / "bootstrap.js").read_text(encoding="utf-8")
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")

    checks = {
        "Map Your Mind action": 'data-action="open-mind-map"' in app,
        "old empty-memory message removed from Today": "Your memories will return here" not in app,
        "mind-map dialog": 'id="mindMapDialog"' in shell,
        "mind-map iframe": 'data-src="./mind-map/"' in shell,
        "isolated CSS": MARKER in css,
        "new runtime build": SILVER_BUILD in bootstrap and SILVER_BUILD in index,
        "recorder regression marker retained": "20260901-recorder-viewport-2" in index,
        "mind-map service-worker policy": "url.pathname.includes('/mind-map/')" in sw,
        "pinned Theory commit metadata": THEORY_COMMIT in (OUTPUT_DIR / "UPSTREAM.json").read_text(encoding="utf-8"),
    }
    failures = [name for name, passed in checks.items() if not passed]
    if failures:
        raise RuntimeError("Integration verification failed: " + ", ".join(failures))

    run("node", "--check", "bootstrap.js")
    run("node", "--check", "sw.js")
    run("node", "--check", "src/app.js")
    run(
        "git",
        "diff",
        "--check",
        "--",
        "src/app.js",
        "src/shell.html",
        "src/styles.css",
        "bootstrap.js",
        "index.html",
        "sw.js",
        "README.md",
    )


if __name__ == "__main__":
    try:
        build_tree = copy_theory_source()
        build_theory(build_tree)
        patch_silver_app()
        patch_silver_shell()
        patch_silver_styles()
        patch_runtime_files()
        patch_readme()
        verify()
        print(
            json.dumps(
                {
                    "status": "ready",
                    "theoryRepository": THEORY_REPOSITORY,
                    "theoryCommit": THEORY_COMMIT,
                    "silverBuild": SILVER_BUILD,
                    "sourceDirectory": str(SOURCE_DIR.relative_to(ROOT)),
                    "outputDirectory": str(OUTPUT_DIR.relative_to(ROOT)),
                },
                indent=2,
            )
        )
    except Exception as error:  # noqa: BLE001
        print(f"ERROR: {error}", file=sys.stderr)
        raise
