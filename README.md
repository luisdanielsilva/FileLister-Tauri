# FileLister-Tauri 📁🛡️

A cross-platform (macOS **and** Windows) rebuild of [FileLister](https://github.com/luisdanielsilva/FileLister) on **Tauri** (Rust backend + React frontend). It scans folders and finds duplicate **files**, duplicate **folders**, and visually similar **photos**, then helps you clean them up safely — everything runs on-device.

## Features

- **Files** — duplicate detection by name+size, verified with SHA-256; media/hidden/symlink filters; 5-signal confidence scoring; byte-verified deletion to the system Trash; batch "Clean All".
- **Folders** — duplicate-folder clustering (union-find on content hashes); in-place merge, safe "copy to new folder" merge, Review One-by-One, Merge All.
- **Photos** — visual similarity via perceptual hashing (dHash + pHash) with optional EXIF corroboration; configurable best-copy keeper; export keepers.
- **Safety & history** — in-app Undo (⌘Z / Ctrl+Z), JSON+HTML operation logs in `~/Documents/FileLister Logs/`, an Operation History viewer, Quick Look-style preview (Space), and the trial/licensing system.

## Develop

Requires [Node.js](https://nodejs.org) and the [Rust toolchain](https://rustup.rs).

```bash
npm install
npm run tauri dev      # run the app
npm run tauri build    # build a local installer for your OS
cargo test --manifest-path src-tauri/Cargo.toml   # run the engine tests
```

## Releases & CI

Installers for macOS and Windows are produced automatically by GitHub Actions — see [`.github/workflows`](.github/workflows).

### How releases work

1. **Bump the version** in `src-tauri/tauri.conf.json` (and `package.json`).
2. **Tag and push:** `git tag v1.2.0 && git push origin v1.2.0`
3. `create-release.yml` opens a GitHub Release for that tag.
4. `build.yml` then compiles on `macos-latest` + `windows-latest` and attaches the `.dmg` and `.msi`/`.exe` to the release.

> Builds are **unsigned**. macOS users right-click → Open the first time; Windows users click "More info → Run anyway" past SmartScreen. Add an Apple Developer ID / Windows code-signing certificate to remove these prompts.

---

*A Tauri port of FileLister by Luís Silva.*
