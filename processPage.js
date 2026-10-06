import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import { ProcessModule } from './modules/processModule.js';
import { addButtonAnimation } from './modules/buttonAnimation.js';

export class ProcessPage {
    constructor(processes = [], animationsEnabled = () => true) {
        this._module = new ProcessModule();
        this._processes = processes;
        this._rows = new Map();
        this._appIcons = new Map();
        this._runningIcons = new Map();
        this._appPids = new Set();
        this._appsOnly = false;
        this._updateRunningApps();
        this._fallbackIcon = new Gio.ThemedIcon({ name: 'application-x-executable' });
        for (const app of Gio.AppInfo.get_all()) {
            const executable = app.get_executable();
            const icon = app.get_icon();
            if (!executable || !icon)
                continue;
            const name = GLib.path_get_basename(executable);
            // These launchers are shared by unrelated applications.
            if (name === 'flatpak' || name === 'env')
                continue;
            this._appIcons.set(name, icon);
            this._appIcons.set(name.slice(0, 15), icon);
        }
        this._selected = null;
        this._busy = false;
        this._ending = false;
        this._destroyed = false;
        this._nextRefresh = 0;
        this._sort = 'cpu';
        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
            style: 'padding: 16px 24px; spacing: 10px;',
            visible: false,
        });
        const toolbar = new St.BoxLayout({ style: 'spacing: 10px;' });
        this._search = new St.Entry({ hint_text: 'Search name or PID…', x_expand: true, can_focus: true,
            style_class: 'systemhud-search' });
        this._search.clutter_text.connect('text-changed', () => this._render());
        toolbar.add_child(this._search);
        this._sortButton = new St.Button({ label: 'Sort: CPU', can_focus: true, style_class: 'button' });
        this._sortButton.connect('clicked', () => {
            this._sort = this._sort === 'cpu' ? 'memory' : this._sort === 'memory' ? 'gpu' : 'cpu';
            this._sortButton.label = `Sort: ${{ cpu: 'CPU', memory: 'Memory', gpu: 'GPU' }[this._sort]}`;
            this._render();
        });
        toolbar.add_child(this._sortButton);
        this._appsButton = new St.Button({ label: 'Apps only', can_focus: true, style_class: 'button' });
        this._appsButton.connect('clicked', () => {
            this._appsOnly = !this._appsOnly;
            this._appsButton.label = this._appsOnly ? 'All processes' : 'Apps only';
            this._updateRunningApps();
            this._render();
        });
        toolbar.add_child(this._appsButton);
        this.actor.add_child(toolbar);
        const header = this._makeRow();
        for (const [text, width] of [['Process', null], ['PID', 48], ['CPU avg', 62], ['GPU', 54], ['RAM MiB', 70]])
            header.add_child(this._label(text, width));
        this.actor.add_child(header);
        this._list = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, style: 'spacing: 4px;' });
        const scroll = new St.ScrollView({ style_class: 'custom-scroll',
            overlay_scrollbars: true, x_expand: true, y_expand: true });
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scroll.set_child(this._list);
        this.actor.add_child(scroll);
        this._message = new St.Label({ text: 'Select a process to end it.', x_expand: true });
        this.actor.add_child(this._message);
        this._feedback = new St.Label({ text: '', x_expand: true });
        this.actor.add_child(this._feedback);
        this._confirmation = new St.Label({ text: '', visible: false, x_expand: true });
        this.actor.add_child(this._confirmation);
        const actions = new St.BoxLayout({ style: 'spacing: 10px;' });
        this._endButton = new St.Button({ label: 'End Task', can_focus: true, style_class: 'button',
            style: 'background-color: #ff453a; color: white; border-radius: 20px; padding: 8px 16px; font-weight: 600;' });
        this._endButton.connect('clicked', () => {
            if (this._destroyed || !this._selected || this._ending)
                return;
            this._pending = this._selected;
            this._confirmation.text = `End ${this._pending.name} (PID ${this._pending.pid})? Unsaved work may be lost.`;
            this._confirmation.show();
            this._confirmButton.show();
            this._cancelButton.show();
            this._endButton.hide();
        });
        actions.add_child(this._endButton);
        this._confirmButton = new St.Button({ label: 'Confirm End Task', can_focus: true,
            style_class: 'button', visible: false, style: 'background-color: #ff453a; color: white; border-radius: 20px; padding: 8px 16px; font-weight: 600;' });
        this._confirmButton.connect('clicked', () => this._endSelected());
        actions.add_child(this._confirmButton);
        this._cancelButton = new St.Button({ label: 'Cancel', can_focus: true, style_class: 'button', visible: false });
        this._cancelButton.connect('clicked', () => this._cancelConfirmation());
        actions.add_child(this._cancelButton);
        this.actor.add_child(actions);
        for (const button of [this._sortButton, this._appsButton, this._endButton, this._confirmButton, this._cancelButton])
            addButtonAnimation(button, animationsEnabled);
        this._render();
    }

    _makeRow() {
        return new St.BoxLayout({ x_expand: true, style: 'spacing: 10px; padding: 7px 10px;' });
    }

    _label(text, width) {
        return new St.Label({ text, width: width ?? -1, x_expand: width === null,
            x_align: width === null ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.END });
    }

    setVisible(visible, refresh = true) {
        this.actor.visible = visible;
        this._cancelConfirmation();
        if (visible) {
            this._nextRefresh = 0;
            if (refresh)
                this.refresh();
        }
    }

    setTheme(colors) {
        this._colors = colors;
        this.actor.set_style(`padding: 16px 24px; spacing: 10px; color: ${colors.text}; font-size: 12px;`);
        this._search.set_style(`background-color: ${colors.surface}; color: ${colors.text}; border: 1px solid ${colors.accent}; border-radius: 20px; padding: 9px 14px;`);
        for (const button of [this._sortButton, this._appsButton, this._cancelButton])
            button.set_style(`background-color: ${colors.surface}; color: ${colors.text}; border-radius: 18px; padding: 8px 14px; font-weight: 600;`);
        this._updateSelection();
    }

    async refresh() {
        if (this._destroyed || !this.actor.visible || this._busy || Date.now() < this._nextRefresh)
            return;
        this._busy = true;
        try {
            const processes = await this._module.list();
            if (this._destroyed)
                return;
            this._updateRunningApps();
            this._processes = processes;
            this._render();
        } catch (error) {
            if (!this._destroyed)
                this._feedback.text = `Could not read processes: ${error.message}`;
        } finally {
            this._busy = false;
            this._nextRefresh = Date.now() + 2000;
        }
    }

    _updateRunningApps() {
        this._runningIcons.clear();
        this._appPids.clear();
        for (const app of Shell.AppSystem.get_default().get_running()) {
            const icon = app.get_app_info()?.get_icon();
            for (const pid of app.get_pids()) {
                this._appPids.add(pid);
                if (icon)
                    this._runningIcons.set(pid, icon);
            }
        }
    }

    _render() {
        const query = this._search.get_text().trim().toLowerCase();
        const visible = this._processes.filter(process =>
            (!this._appsOnly || this._appPids.has(process.pid)) &&
            (process.name.toLowerCase().includes(query) || String(process.pid).includes(query)));
        visible.sort((a, b) => (b[this._sort] ?? -1) - (a[this._sort] ?? -1) || a.pid - b.pid);
        const pids = new Set(visible.map(process => process.pid));
        for (const [pid, row] of this._rows) {
            if (!pids.has(pid)) {
                row.button.destroy();
                this._rows.delete(pid);
            }
        }
        visible.forEach((process, index) => {
            let row = this._rows.get(process.pid);
            if (!row) {
                const box = this._makeRow();
                const icon = new St.Icon({ icon_size: 20, y_align: Clutter.ActorAlign.CENTER });
                box.add_child(icon);
                const labels = [this._label('', null), this._label('', 48), this._label('', 62), this._label('', 54), this._label('', 70)];
                labels.forEach(label => box.add_child(label));
                const button = new St.Button({ child: box, x_expand: true, can_focus: true,
                    style_class: 'process-row' });
                row = { button, icon, labels, process };
                button.connect('clicked', () => {
                    if (this._destroyed || this._ending)
                        return;
                    this._cancelConfirmation();
                    this._feedback.text = '';
                    this._selected = row.process;
                    this._updateSelection();
                });
                this._rows.set(process.pid, row);
                this._list.add_child(button);
            }
            row.process = process;
            row.icon.gicon = this._runningIcons.get(process.pid) ??
                this._appIcons.get(process.name) ?? this._fallbackIcon;
            const texts = [process.name, String(process.pid), `${process.cpu.toFixed(1)}%`,
                Number.isFinite(process.gpu) ? `${process.gpu.toFixed(1)}%` : '—', process.memory.toFixed(1)];
            row.labels.forEach((label, i) => label.text = texts[i]);
            this._list.set_child_at_index(row.button, index);
        });
        if (this._selected && !visible.some(process => process.pid === this._selected.pid &&
            process.started === this._selected.started)) {
            this._selected = null;
            this._cancelConfirmation();
        }
        this._updateSelection();
    }

    _updateSelection() {
        for (const row of this._rows.values()) {
            const selected = row.process.pid === this._selected?.pid;
            row.button.set_style(selected ? 'background-color: #0a84ff; color: white; border-radius: 12px;' :
                `background-color: ${this._colors?.surface ?? '#2c2c2e'}; color: ${this._colors?.text ?? '#ffffff'}; border-radius: 12px;`);
        }
        const allowed = !!this._selected && this._module.canEnd(this._selected) && !this._ending;
        this._endButton.reactive = allowed;
        this._endButton.can_focus = allowed;
        this._endButton.opacity = allowed ? 255 : 100;
        if (!this._ending)
            this._message.text = this._selected ?
                `${this._selected.name} · PID ${this._selected.pid}${allowed ? '' : ' · Protected or owned by another user'}` :
                `${this._rows.size} ${this._appsOnly ? 'app processes' : 'processes'} · GPU —: waiting or unavailable`;
    }

    _cancelConfirmation() {
        this._pending = null;
        this._confirmation.hide();
        this._confirmButton.hide();
        this._cancelButton.hide();
        this._endButton.show();
    }

    async _endSelected() {
        const process = this._pending;
        if (this._destroyed || !process || this._ending)
            return;
        this._ending = true;
        this._cancelConfirmation();
        this._updateSelection();
        try {
            await this._module.end(process);
            if (!this._destroyed)
                this._feedback.text = `Asked ${process.name} (PID ${process.pid}) to exit.`;
        } catch (error) {
            if (!this._destroyed)
                this._feedback.text = `Could not end task: ${error.message}`;
        } finally {
            this._ending = false;
            this._nextRefresh = 0;
        }
    }

    getSnapshot() {
        return this._processes.slice();
    }

    destroy() {
        this._destroyed = true;
        this._module.destroy();
        this._rows.clear();
        this._appIcons.clear();
        this._runningIcons.clear();
        this._appPids.clear();
    }
}
