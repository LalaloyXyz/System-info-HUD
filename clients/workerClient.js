import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class WorkerClient {
    constructor(extensionPath) {
        this._cancellable = new Gio.Cancellable();
        this._startupTimeout = 0;
        // One bundled GJS process handles all collection outside GNOME Shell.
        // Closing its stdin on disable also lets it detect an unexpected parent exit.
        this._process = Gio.Subprocess.new([
            'gjs', '-m', `${extensionPath}/app/worker.js`,
        ], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        this._stdout = new Gio.DataInputStream({ base_stream: this._process.get_stdout_pipe() });
        this.ready = new Promise((resolve, reject) => {
            this._startupTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
                this._startupTimeout = 0;
                this._process?.force_exit();
                this.destroy();
                return GLib.SOURCE_REMOVE;
            });
            this._stdout.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
                this._removeTimeout('_startupTimeout');
                try {
                    const [line] = stream.read_line_finish_utf8(result);
                    if (!line || !/^:\d+\.\d+$/.test(line))
                        throw new Error('System HUD collector failed to start.');
                    resolve(line);
                } catch (error) {
                    reject(error);
                    this.destroy();
                }
            });
        });
        this.ready.catch(() => {});
        this._process.wait_async(null, (process, result) => {
            process.wait_finish(result);
            this._removeTimeout('_startupTimeout');
            this._process = null;
            this._stdout = null;
        });
    }

    _removeTimeout(property) {
        if (this[property])
            GLib.Source.remove(this[property]);
        this[property] = 0;
    }

    destroy() {
        this._cancellable.cancel();
        this._removeTimeout('_startupTimeout');
        if (this._process) {
            this._process.get_stdin_pipe().close(null);
            this._process = null;
        }
        this._stdout = null;
    }
}
