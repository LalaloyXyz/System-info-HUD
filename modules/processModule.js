import Gio from 'gi://Gio';
import { getProcessGpuCommand } from './processGpu.js';

export class ProcessModule {
    constructor() {
        this._cancellable = new Gio.Cancellable();
        this._subprocesses = new Set();
        const credentials = new Gio.Credentials();
        this._uid = credentials.get_unix_user();
        this._pid = credentials.get_unix_pid();
        this._gpuSnapshot = null;
    }

    async _execute(argv) {
        this._cancellable.set_error_if_cancelled();
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        launcher.setenv('LC_ALL', 'C', true);
        const proc = launcher.spawnv(argv);
        this._subprocesses.add(proc);
        const pid = Number(proc.get_identifier());
        return new Promise((resolve, reject) => {
            proc.communicate_utf8_async(null, this._cancellable, (subprocess, result) => {
                this._subprocesses.delete(subprocess);
                try {
                    const [, stdout, stderr] = subprocess.communicate_utf8_finish(result);
                    if (!subprocess.get_successful())
                        throw new Error(stderr.trim() || 'Process command failed');
                    resolve({ stdout, pid });
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    async list(pid = null) {
        const argv = ['ps', '-o', 'pid=,uid=,pcpu=,rss=,lstart=,comm='];
        argv.push(...(pid === null ? ['-e'] : ['-p', String(pid)]));
        const { stdout, pid: collectorPid } = await this._execute(argv);
        const processes = stdout.split('\n').flatMap(line => {
            const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/);
            // Do not display the temporary ps command collecting this snapshot.
            if (!match || Number(match[1]) === collectorPid)
                return [];
            return [{ pid: Number(match[1]), uid: Number(match[2]), cpu: Number(match[3]),
                memory: Number(match[4]) / 1024, started: match[5], name: match[6] }];
        });
        if (pid === null) {
            try {
                const pids = processes.filter(process => process.uid === this._uid).map(process => String(process.pid));
                const { stdout: gpuOutput } = await this._execute(getProcessGpuCommand(pids));
                this._updateGpu(processes, JSON.parse(gpuOutput));
            } catch (error) {
                if (this._cancellable.is_cancelled())
                    throw error;
                this._gpuSnapshot = null;
                for (const process of processes)
                    process.gpu = null;
            }
        }
        return processes;
    }

    _updateGpu(processes, snapshot) {
        const previous = this._gpuSnapshot;
        const elapsed = previous ? snapshot.time - previous.time : 0;
        for (const process of processes) {
            process.gpu = null;
            const clients = snapshot.processes[process.pid] ?? {};
            const old = previous?.processes[process.pid] ?? {};
            if (elapsed <= 0 || previous?.started[process.pid] !== process.started)
                continue;
            const devices = new Map();
            for (const [id, client] of Object.entries(clients)) {
                for (const [engine, counter] of Object.entries(client.engines)) {
                    const before = old[id]?.engines[engine];
                    if (!before)
                        continue;
                    // Some drivers temporarily report a lower cumulative counter.
                    if (counter.time < before.time) {
                        counter.time = before.time;
                        continue;
                    }
                    const key = `${client.device}:${engine}`;
                    const usage = (counter.time - before.time) / elapsed / Math.max(1, counter.capacity) * 100;
                    devices.set(key, (devices.get(key) ?? 0) + usage);
                }
            }
            if (devices.size)
                process.gpu = Math.min(100, Math.max(...devices.values()));
        }
        snapshot.started = Object.fromEntries(processes.map(process => [process.pid, process.started]));
        this._gpuSnapshot = snapshot;
    }

    canEnd(process) {
        return process.pid > 1 && process.pid !== this._pid &&
            process.uid === this._uid && process.name !== 'gnome-shell';
    }

    async end(process) {
        if (!this.canEnd(process))
            throw new Error('This process cannot be ended from the HUD.');
        const [current] = await this.list(process.pid);
        if (!current || current.started !== process.started || current.name !== process.name ||
            current.uid !== process.uid)
            throw new Error('The process has exited or changed. Refresh the list and try again.');
        await this._execute(['kill', '-TERM', '--', String(process.pid)]);
    }

    destroy() {
        this._cancellable.cancel();
        for (const subprocess of this._subprocesses)
            subprocess.force_exit();
        this._subprocesses.clear();
        this._gpuSnapshot = null;
    }
}
