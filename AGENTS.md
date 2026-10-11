# Repository Guidelines

## Project Structure & Module Organization

This repository contains a GNOME Shell extension and its bundled GJS collector. Keep GNOME's entry files (`extension.js`, `prefs.js`, `metadata.json`, and `stylesheet.css`) at the root. HUD views, themes, graphs, and presentation helpers live in `ui/`. Collector lifecycle and D-Bus clients live in `clients/`. Hardware collectors and all telemetry command execution live in `companion/modules/`, with the bundled D-Bus worker in `companion/`. Keep icons in `assets/`, GSettings source XML in `schemas/`, tests in `tests/`, and generated packages in the ignored `dist/` directory.

## Build, Test, and Development Commands

Use the Makefiles and GNOME tooling to validate and package changes:

- `glib-compile-schemas schemas/` compiles settings after schema edits. Do not commit the generated `schemas/gschemas.compiled` file.
- `make pack` creates one extension ZIP under `dist/`. It includes `assets/`, `ui/`, `clients/`, and `companion/`; it excludes tests and installers. No separate companion installation is needed.
- `gnome-extensions install --force dist/systemHUD@LalaloyXyz.shell-extension.zip` installs the extension archive locally.
- After installing or updating, run `glib-compile-schemas ~/.local/share/gnome-shell/extensions/systemHUD@LalaloyXyz/schemas/` so the installed compiled schema includes newly added keys.
- `gnome-extensions enable systemHUD@LalaloyXyz` enables it for the current user.
- `journalctl --user -f -o cat /usr/bin/gnome-shell` follows Shell logs during manual testing. On Wayland, log out and back in to reload if needed.

## Coding Style & Naming Conventions

Follow the existing JavaScript style: four-space indentation, semicolons, and descriptive camelCase names. Keep module responsibilities aligned with the existing `*Module.js` files and avoid unrelated formatting changes. Match GNOME Shell/GJS APIs already used in the code. Use clear kebab-case names for asset files and preserve the settings schema ID defined in `metadata.json`.

## Testing Guidelines

Run `gjs -m tests/hardware.js`, `gjs -m tests/lifecycle.js`, and `node tests/hud.js` for collector and lifecycle regressions. Run `GIO_USE_VFS=local dbus-run-session -- gjs -m tests/service.js` for bundled-collector D-Bus integration and shutdown checks; no installed service is needed. `tests/render.js` requires the GNOME Shell and Mutter typelib/library paths. For changes, compile schemas when relevant, pack the extension, then manually check the affected HUD section or preference in a supported GNOME Shell session. Review Shell logs for runtime errors and include the tested GNOME Shell version and relevant hardware/tool availability when reporting results.

## Commit & Pull Request Guidelines

Recent commits use short, direct summaries in sentence case (for example, `Remove unnecessary try-catch wrappers`). Keep commits focused and describe the user-visible change or fix. Pull requests should explain the behavior changed, list manual verification performed, link related issues when applicable, and include screenshots for visual changes. Mention GNOME Shell version and hardware details for telemetry-related fixes.

## Configuration & Platform Notes

The extension targets GNOME Shell 45–51. Core system tools are documented in `README.md`; hardware-specific commands such as `nvidia-smi`, `rocm-smi`, and `intel_gpu_top` are optional. Preserve graceful fallback behavior when optional tools or hardware are unavailable, and do not include machine-specific settings or generated build artifacts in commits.
