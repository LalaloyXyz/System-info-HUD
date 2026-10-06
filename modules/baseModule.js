import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class BaseModule {
    constructor(cacheTTL = 5000) {
        this._cache = { data: null, timestamp: 0 };
        this._cacheTTL = cacheTTL;
        this._cancellable = new Gio.Cancellable();
        this._commands = new Map();
    }

    _getStatusMarker(value, thresholds) {
        if (value >= thresholds[0]) return '[!!!]';
        if (value >= thresholds[1]) return '[!!]';
        if (value >= thresholds[2]) return '[!]';
        if (value >= thresholds[3]) return '[+]';
        if (thresholds.length > 4 && value >= thresholds[4]) return '[-]';
        if (thresholds.length > 5) return '[·]';
        return '[-]';
    }

    _isCacheValid() {
        const now = Date.now();
        return this._cache.data !== null &&
               (now - this._cache.timestamp < this._cacheTTL);
    }

    _updateCache(data) {
        this._cache = {
            data,
            timestamp: Date.now()
        };
    }

    clearCache() {
        this._cache = { data: null, timestamp: 0 };
    }

    async _listDirs(path, pattern) {
        const names = [];
        try {
            const enumerator = Gio.File.new_for_path(path).enumerate_children(
                'standard::name', Gio.FileQueryInfoFlags.NONE, null);
            try {
                let info;
                while ((info = enumerator.next_file(null))) {
                    if (pattern.test(info.get_name()))
                        names.push(info.get_name());
                }
            } finally {
                enumerator.close(null);
            }
        } catch (_) {
            // Optional sysfs directories are absent on some drivers.
        }
        return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    async _executeCommand(argv) {
        if (this._cancellable.is_cancelled())
            return '';
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            launcher.setenv('LC_ALL', 'C', true);
            const subprocess = launcher.spawnv(argv);

            return await new Promise((resolve, reject) => {
                let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
                    timeoutId = 0;
                    this._commands.set(subprocess, 0);
                    subprocess.force_exit();
                    return GLib.SOURCE_REMOVE;
                });
                this._commands.set(subprocess, timeoutId);
                subprocess.communicate_utf8_async(null, this._cancellable, (proc, res) => {
                    timeoutId = this._commands.get(proc);
                    if (timeoutId)
                        GLib.Source.remove(timeoutId);
                    this._commands.delete(proc);
                    try {
                        const [successful, stdout, stderr] = proc.communicate_utf8_finish(res);
                        if (!successful || !proc.get_successful()) {
                            const message = stderr?.toString().trim() || `Command failed: ${argv[0]}`;
                            reject(new Error(message));
                            return;
                        }
                        resolve(stdout ? stdout.toString() : '');
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        } catch (e) {
            if (!this._cancellable.is_cancelled())
                logError(e, `Error executing: ${argv.join(" ")}`);
            return "";
        }
    }

    async _readFile(path, optional = false) {
        if (this._cancellable.is_cancelled())
            return '';
        try {
            const file = Gio.File.new_for_path(path);
            const [ok, contents] = await new Promise((resolve, reject) => {
                file.load_contents_async(this._cancellable, (f, res) => {
                    try {
                        resolve(f.load_contents_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            return ok ? new TextDecoder().decode(contents) : "";
        } catch (e) {
            if (!optional && !this._cancellable.is_cancelled())
                logError(e, `Failed to read file: ${path}`);
            return "";
        }
    }

    destroy() {
        this._cancellable.cancel();
        for (const [subprocess, timeoutId] of this._commands) {
            if (timeoutId)
                GLib.Source.remove(timeoutId);
            subprocess.force_exit();
        }
        this._commands.clear();
        this.clearCache();
    }
}
