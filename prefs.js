import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SystemHUDPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let settings;

        try {
            settings = this.getSettings();
        } catch (error) {
            const page = new Adw.PreferencesPage({
                title: _('General'),
                icon_name: 'preferences-system-symbolic',
            });
            window.add(page);

            const group = new Adw.PreferencesGroup({
                title: _('Settings unavailable'),
                description: _('The compiled GSettings schema for System HUD is missing, so preferences cannot be loaded yet.'),
            });
            page.add(group);

            group.add(new Adw.ActionRow({
                title: _('Missing file'),
                subtitle: _('schemas/gschemas.compiled'),
            }));

            group.add(new Adw.ActionRow({
                title: _('How to fix it'),
                subtitle: _('Run `glib-compile-schemas schemas/` in the extension folder, then reinstall or copy the updated files.'),
            }));

            logError(error, 'System HUD: failed to load preferences schema');
            return;
        }

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const behaviorGroup = new Adw.PreferencesGroup({
            title: _('Behavior'),
            description: _('Adjust animation, actions and refresh timing for the HUD.'),
        });
        page.add(behaviorGroup);

        const animationRow = new Adw.SwitchRow({
            title: _('Enable animations'),
            subtitle: _('Animate the HUD when opening and closing.'),
        });
        settings.bind('enable-animations', animationRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(animationRow);

        const copyButtonRow = new Adw.SwitchRow({
            title: _('Show copy button'),
            subtitle: _('Display the button that copies the visible system information.'),
        });
        settings.bind('show-copy-button', copyButtonRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(copyButtonRow);

        const refreshRow = new Adw.SpinRow({
            title: _('Fetch interval'),
            subtitle: _('Base time between data refreshes in milliseconds.'),
            adjustment: new Gtk.Adjustment({
                lower: 500,
                upper: 10000,
                step_increment: 100,
                page_increment: 500,
                value: settings.get_int('refresh-interval-ms'),
            }),
            digits: 0,
        });
        refreshRow.set_value(settings.get_int('refresh-interval-ms'));

        let updating = false;

        refreshRow.connect('notify::value', row => {
            if (updating)
                return;

            const value = Math.max(500, Math.min(10000, Math.round(row.get_value())));
            if (settings.get_int('refresh-interval-ms') !== value)
                settings.set_int('refresh-interval-ms', value);
        });

        settings.connect('changed::refresh-interval-ms', () => {
            const value = settings.get_int('refresh-interval-ms');
            updating = true;
            refreshRow.set_value(value);
            updating = false;
        });

        behaviorGroup.add(refreshRow);

        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display'),
            description: _('Adjust the HUD size and visible monitoring details.'),
        });
        page.add(displayGroup);

        const addPercentRow = (key, title, subtitle) => {
            const row = new Adw.SpinRow({
                title: _(title),
                subtitle: _(subtitle),
                adjustment: new Gtk.Adjustment({
                    lower: 25,
                    upper: 70,
                    step_increment: 1,
                    page_increment: 5,
                    value: settings.get_int(key),
                }),
                digits: 0,
            });
            row.set_value(settings.get_int(key));

            let updating = false;
            row.connect('notify::value', spinRow => {
                if (updating)
                    return;
                const value = Math.max(25, Math.min(70, Math.round(spinRow.get_value())));
                if (settings.get_int(key) !== value)
                    settings.set_int(key, value);
            });
            settings.connect(`changed::${key}`, () => {
                updating = true;
                row.set_value(settings.get_int(key));
                updating = false;
            });
            displayGroup.add(row);
        };

        addPercentRow('window-width-percent', 'HUD width', 'Width as a percentage of the primary monitor.');
        addPercentRow('window-height-percent', 'HUD height', 'Height as a percentage of the primary monitor.');

        const powerRow = new Adw.SwitchRow({
            title: _('Show power section'),
            subtitle: _('Display battery charge, power use and remaining time.'),
        });
        settings.bind('show-power-section', powerRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(powerRow);

        const graphRow = new Adw.SwitchRow({
            title: _('Show CPU graph'),
            subtitle: _('Display the per-core CPU history graph.'),
        });
        settings.bind('show-cpu-graph', graphRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(graphRow);
    }
}
