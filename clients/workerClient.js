import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import '../companion/worker.js';

export class WorkerClient {
    constructor(extensionPath) {
        this._cancellable = new Gio.Cancellable();
        this._startupTimeout = 0;
        this._stopping = false;
        // One bundled GJS process handles all collection outside GNOME Shell.
        // Closing its stdin on disable also lets it detect an unexpected parent exit.
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
        });
        launcher.setenv('SYSTEMHUD_WORKER', '1', true);
        this._process = launcher.spawnv([
            'gjs', '-m', GLib.build_filenamev([extensionPath, 'companion', 'worker.js']),
        ]);
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
        if (this._stopping)
            return;
        this._stopping = true;
        this._cancellable.cancel();
        this._removeTimeout('_startupTimeout');
        if (!this._process)
            return;
        this._process.get_stdin_pipe().close(null);
    }
}
