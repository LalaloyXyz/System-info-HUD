PREFIX ?= $(HOME)/.local
LIBEXECDIR = $(PREFIX)/libexec/system-hud
DATADIR = $(PREFIX)/share

.PHONY: install uninstall
install:
	install -d "$(DESTDIR)$(LIBEXECDIR)/modules" "$(DESTDIR)$(DATADIR)/dbus-1/services" "$(DESTDIR)$(DATADIR)/licenses/system-hud"
	install -m 644 service.js systemLink.js "$(DESTDIR)$(LIBEXECDIR)/"
	install -m 644 modules/*.js "$(DESTDIR)$(LIBEXECDIR)/modules/"
	install -m 644 ../LICENSE "$(DESTDIR)$(DATADIR)/licenses/system-hud/"
	printf '[D-BUS Service]\nName=io.github.LalaloyXyz.SystemHUD\nExec=/usr/bin/gjs -m "$(LIBEXECDIR)/service.js"\n' > "$(DESTDIR)$(DATADIR)/dbus-1/services/io.github.LalaloyXyz.SystemHUD.service"

uninstall:
	rm -f "$(DESTDIR)$(DATADIR)/dbus-1/services/io.github.LalaloyXyz.SystemHUD.service"
	rm -rf "$(DESTDIR)$(LIBEXECDIR)" "$(DESTDIR)$(DATADIR)/licenses/system-hud"
