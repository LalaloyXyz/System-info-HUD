DIST_DIR ?= dist

.PHONY: pack pack-extension
pack: pack-extension

pack-extension:
	mkdir -p "$(DIST_DIR)/schemas"
	glib-compile-schemas --strict --targetdir="$(DIST_DIR)/schemas" schemas
	gnome-extensions pack --force --extra-source=assets --extra-source=ui --extra-source=clients --extra-source=companion --out-dir="$(DIST_DIR)" .
