const { Gio, GLib } = imports.gi;

export class BaseModule {
    constructor(cacheTTL = 5000) {
        this._cache = { data: null, timestamp: 0 };
        this._cacheTTL = cacheTTL;
    }

    _getStatusEmoji(value, thresholds) {
        if (value >= thresholds[0]) return "🟥";
        if (value >= thresholds[1]) return "🟧";
        if (value >= thresholds[2]) return "🟨";
        if (value >= thresholds[3]) return "🟩";
        if (thresholds.length > 4 && value >= thresholds[4]) return "⬜️";
        if (thresholds.length > 5) return "🟦";
        return "⬜️";
    }

    _isCacheValid() {
        const now = Date.now();
        return this._cache.data &&
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

    async _executeCommand(argv) {
        try {
            const subprocess = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);

            return await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        const [, stdout] = proc.communicate_utf8_finish(res);
                        resolve(stdout ? stdout.toString() : "");
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        } catch (e) {
            logError(e, `Error executing: ${argv.join(" ")}`);
            return "";
        }
    }

    async _readFile(path) {
        try {
            const file = Gio.File.new_for_path(path);
            const [ok, contents] = await new Promise((resolve, reject) => {
                file.load_contents_async(null, (f, res) => {
                    try {
                        resolve(f.load_contents_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            return ok ? contents.toString() : "";
        } catch (e) {
            logError(e, `Failed to read file: ${path}`);
            return "";
        }
    }
}
