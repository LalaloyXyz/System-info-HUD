# Repository Guidelines

## Project Structure & Module Organization

This repository is a GNOME Shell extension. The root JavaScript files handle extension lifecycle, preferences, UI, themes, system links, and refresh coordination. Hardware-specific collectors live in `modules/` (`cpuModule.js`, `gpuModule.js`, `memoryModule.js`, `networkModule.js`, `powerModule.js`, `storageModule.js`, and `systemModule.js`), with shared behavior in `baseModule.js`. Keep presentation assets in `assets/` and the GSettings definition in `schemas/`. `metadata.json` defines the extension UUID and supported GNOME Shell versions.

## Build, Test, and Development Commands

There is no separate build system or automated test suite in the repository. Use the GNOME tooling to validate and package changes:

- `glib-compile-schemas schemas/` compiles settings after schema edits. Do not commit the generated `schemas/gschemas.compiled` file.
- `gnome-extensions pack --force --extra-source=assets --extra-source=modules --extra-source=systemLink.js --extra-source=themeManager.js --extra-source=uiManager.js --extra-source=updateData.js --extra-source=processPage.js` creates a complete installable archive. GNOME's packer otherwise omits these imported files.
- `gnome-extensions install --force systemHUD@LalaloyXyz.shell-extension.zip` installs the archive locally.
- After installing or updating, run `glib-compile-schemas ~/.local/share/gnome-shell/extensions/systemHUD@LalaloyXyz/schemas/` so the installed compiled schema includes newly added keys.
- `gnome-extensions enable systemHUD@LalaloyXyz` enables it for the current user.
- `journalctl --user -f -o cat /usr/bin/gnome-shell` follows Shell logs during manual testing. On Wayland, log out and back in to reload if needed.

## Coding Style & Naming Conventions

Follow the existing JavaScript style: four-space indentation, semicolons, and descriptive camelCase names. Keep module responsibilities aligned with the existing `*Module.js` files and avoid unrelated formatting changes. Match GNOME Shell/GJS APIs already used in the code. Use clear kebab-case names for asset files and preserve the settings schema ID defined in `metadata.json`.

## Testing Guidelines

No test framework or coverage requirement is configured. For changes, compile schemas when relevant, pack the extension, then manually check the affected HUD section or preference in a supported GNOME Shell session. Review Shell logs for runtime errors and include the tested GNOME Shell version and relevant hardware/tool availability when reporting results.

## Commit & Pull Request Guidelines

Recent commits use short, direct summaries in sentence case (for example, `Remove unnecessary try-catch wrappers`). Keep commits focused and describe the user-visible change or fix. Pull requests should explain the behavior changed, list manual verification performed, link related issues when applicable, and include screenshots for visual changes. Mention GNOME Shell version and hardware details for telemetry-related fixes.

## Configuration & Platform Notes

The extension targets GNOME Shell 45–51. Core system tools are documented in `README.md`; hardware-specific commands such as `nvidia-smi`, `rocm-smi`, and `intel_gpu_top` are optional. Preserve graceful fallback behavior when optional tools or hardware are unavailable, and do not include machine-specific settings or generated build artifacts in commits.
