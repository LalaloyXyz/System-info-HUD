import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export default class mainShow extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._indicator.add_style_class_name('panel-button');

        this._label = new St.Label({
            text: 'Info',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._indicator.add_child(this._label);

        this._indicator.connect('button-press-event', () => {
            const isActive = this._indicator.has_style_class_name('active');

            if (isActive) {
                this._indicator.remove_style_class_name('active');
                this._destroyMainScreen();
            } else {
                this._indicator.add_style_class_name('active');
                this._showMainScreen();
            }
        });

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._uptimeTimeoutId = null;
        this._deviceWithUptime = null;
    }

    _createColumn_width(width, backgroundColor = 'transparent') {
        const column = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${backgroundColor}; border: 0px solid white;`,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        column.set_width(width);
        return column;
    }

    _createColumn_height(height, backgroundColor = 'transparent') {
        const column = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${backgroundColor}; border: 0px solid white;`,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        column.set_height(height);
        return column;
    }

    _enableDrag(actor) {
        let dragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let actorStartX = 0;
        let actorStartY = 0;

        actor.connect('button-press-event', (actor, event) => {
            dragging = true;
            const [x, y] = event.get_coords();
            dragStartX = x;
            dragStartY = y;

            [actorStartX, actorStartY] = this._main_screen.get_position();
            return Clutter.EVENT_STOP;
        });

        actor.connect('motion-event', (actor, event) => {
            if (!dragging) return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            const dx = x - dragStartX;
            const dy = y - dragStartY;
            this._main_screen.set_position(actorStartX + dx, actorStartY + dy);
            return Clutter.EVENT_STOP;
        });

        actor.connect('button-release-event', () => {
            dragging = false;
            return Clutter.EVENT_STOP;
        });
    }

    _showMainScreen() {
        const monitor = Main.layoutManager.primaryMonitor;
        const popupWidth = Math.floor(monitor.width * 0.4);
        const popupHeight = Math.floor(monitor.height * 0.4);

        this._main_screen = new St.BoxLayout({
            vertical: false,
            style: 'background-color: #212121; border-radius: 40px;',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const frontColumn = this._createColumn_width(Math.floor(popupWidth * 0.05));
        const leftColumn = this._createColumn_width(Math.floor(popupWidth * 0.43));
        const centerSpacer = this._createColumn_width(Math.floor(popupWidth * 0.1));
        const rightColumn = this._createColumn_width(Math.floor(popupWidth * 0.42));

        const topLeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.06));
        const top1_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.18));

        const topRightColumn = this._createColumn_height(Math.floor(popupHeight * 0.06));

        this._enableDrag(this._main_screen);

        this._main_screen.add_child(frontColumn);
        this._main_screen.add_child(leftColumn);
        this._main_screen.add_child(centerSpacer);
        this._main_screen.add_child(rightColumn);

        // left column
        leftColumn.add_child(topLeftColumn);
        leftColumn.add_child(top1_LeftColumn);

        // user profile
        const userName = GLib.get_user_name();
        const DeviceName = GLib.get_host_name();
        const profileImagePath = `/var/lib/AccountsService/icons/${userName}`;
        const avatarSize = Math.floor(popupHeight * 0.18);

        const profileRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const profileBin = new St.Bin({
            width: avatarSize,
            height: avatarSize,
            style: `
                background-image: url("file://${profileImagePath}");
                background-size: cover;
                background-position: center;
                border-radius: 360px;
                border: 3px solid white;
            `,
            clip_to_allocation: true,
        });

        profileRow.add_child(profileBin);

        const labelBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            style: 'padding-left: 20px;',
        });

        const deviceLabel = new St.Label({
            text: `Device name`,
            style: 'color: white; font-weight: bold; font-size: 14px;',
        });

        const deviceNameRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });

        this._deviceWithUptime = new St.Label({
            text: 'Loading uptime...',
            style: 'color: white; font-weight: bold; font-size: 18px;',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
        });

        deviceNameRow.add_child(this._deviceWithUptime);

        labelBox.add_child(deviceLabel);
        labelBox.add_child(deviceNameRow);

        profileRow.add_child(labelBox);

        top1_LeftColumn.add_child(profileRow);

        // right column
        rightColumn.add_child(topRightColumn);

        this._main_screen.set_size(popupWidth, popupHeight);

        Main.layoutManager.addChrome(this._main_screen, {
            trackFullscreen: true,
        });

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this._main_screen) return GLib.SOURCE_REMOVE;

            const [_, natWidth] = this._main_screen.get_preferred_width(-1);
            const [__, natHeight] = this._main_screen.get_preferred_height(-1);
            const x = Math.floor((monitor.width - natWidth) / 2) + monitor.x;
            const y = Math.floor((monitor.height - natHeight) / 2) + monitor.y;

            this._main_screen.set_position(x, y);
            return GLib.SOURCE_REMOVE;
        });

        this._updateUptime();
        this._uptimeTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._updateUptime());
    }

    _updateUptime() {
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/uptime');
            if (ok) {
                const uptimeSeconds = parseFloat(imports.byteArray.toString(contents).split(' ')[0]);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = Math.floor(uptimeSeconds % 60);

                const DeviceName = GLib.get_host_name();
                if (this._deviceWithUptime) {
                    this._deviceWithUptime.text = `${DeviceName} : ${hours}H ${minutes}M ${seconds}s`;
                }
            }
        } catch (e) {
            log('Failed to update uptime: ' + e.message);
        }

        return true;
    }

    _destroyMainScreen() {
        if (this._uptimeTimeoutId) {
            GLib.source_remove(this._uptimeTimeoutId);
            this._uptimeTimeoutId = null;
        }

        if (this._main_screen) {
            Main.layoutManager.removeChrome(this._main_screen);
            this._main_screen.destroy();
            this._main_screen = null;
        }
    }

    disable() {
        if (this._uptimeTimeoutId) {
            GLib.source_remove(this._uptimeTimeoutId);
            this._uptimeTimeoutId = null;
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._destroyMainScreen();
    }
}
