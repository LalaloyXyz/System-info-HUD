DIST_DIR ?= dist

.PHONY: pack pack-extension pack-companion
pack: pack-extension pack-companion

pack-extension:
	mkdir -p "$(DIST_DIR)/schemas"
	glib-compile-schemas --strict --targetdir="$(DIST_DIR)/schemas" schemas
	gnome-extensions pack --force --extra-source=assets --extra-source=ui --extra-source=clients --out-dir="$(DIST_DIR)" .

pack-companion:
	mkdir -p "$(DIST_DIR)"
	tar -czf "$(DIST_DIR)/system-hud-companion.tar.gz" companion LICENSE
