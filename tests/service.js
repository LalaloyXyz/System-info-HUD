// Run in a private dbus-run-session; no installed companion is needed.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { SystemClient } from '../clients/systemClient.js';
import { ProcessClient } from '../clients/processClient.js';
import { WorkerClient } from '../clients/workerClient.js';

const extensionPath = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));

let checks = 0;
function assert(value, message) {
    checks++;
    if (!value)
        throw new Error(message);
}

async function owner(destination) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'NameHasOwner',
            new GLib.Variant('(s)', [destination]),
            new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, 5000, null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result).deep_unpack()[0]);
                } catch (error) {
                    reject(error);
                }
            });
    });
}

assert(!await owner('io.github.LalaloyXyz.SystemHUD'), 'No installed companion is running');
const worker = new WorkerClient(extensionPath);
const childWorker = worker._process;
const system = new SystemClient(worker);
// Calls made before readiness must wait for the collector's exported interface.
assert(typeof await system.getUptime() === 'string', 'Bundled collector cold start returns uptime');
const destination = await worker.ready;
assert(await owner(destination), 'Worker owns its unique D-Bus connection');
assert(!await owner('io.github.LalaloyXyz.SystemHUD'), 'Collector never activates the installed companion');
const info = await system.getAllInfo();
assert(info.system.osName && info.system.kernelVersion, 'System telemetry crosses D-Bus');
assert(Array.isArray(info.cpu.coreDetails) && info.cpu.coreDetails.length > 0, 'CPU telemetry crosses D-Bus');
assert(info.memory.max && info.memory.percent, 'Memory telemetry crosses D-Bus');
assert(typeof info.gpu === 'string' && typeof info.storage === 'string' &&
    typeof info.power === 'string', 'GPU, storage and power preserve their output formats');
assert(info.network.networkSpeed && info.network.lanIP, 'Network telemetry crosses D-Bus');
await system.call('ClearCache');
let invalidModule = false;
try {
    await system.call('GetInfo', new GLib.Variant('(s)', ['arbitrary-command']));
} catch (_) {
    invalidModule = true;
}
assert(invalidModule, 'Service rejects unsupported operations');

const processes = new ProcessClient(worker);
const child = Gio.Subprocess.new(['sleep', '60'], Gio.SubprocessFlags.NONE);
try {
    const pid = Number(child.get_identifier());
    const [row] = await processes.list(pid);
    assert(row?.pid === pid && row.name === 'sleep', 'Process identity crosses D-Bus');
    const snapshot = await processes.list();
    const workerRow = snapshot.find(process => process.pid === Number(childWorker.get_identifier()));
    let protectedWorker = false;
    try {
        await processes.end(workerRow);
    } catch (_) {
        protectedWorker = true;
    }
    assert(workerRow && protectedWorker, 'Collector protects its own process');
    assert(snapshot.some(process => process.pid === pid && Object.hasOwn(process, 'gpu')),
        'Full process list includes GPU results');
    assert((await processes.list()).some(process => process.pid === pid),
        'Repeated GPU collection works in the same companion process');
    let stale = false;
    try {
        await processes.end({ ...row, started: 'stale identity' });
    } catch (_) {
        stale = true;
    }
    assert(stale, 'End Task rejects stale process identity');
    let invalid = false;
    try {
        await system.call('EndProcess', new GLib.Variant('(s)', [JSON.stringify({ pid: '2;bad' })]));
    } catch (_) {
        invalid = true;
    }
    assert(invalid, 'Service rejects invalid process identities');
    const shell = snapshot.find(process => process.name === 'gnome-shell');
    if (shell) {
        let protectedShell = false;
        try {
            await system.call('EndProcess', new GLib.Variant('(s)', [JSON.stringify(shell)]));
        } catch (_) {
            protectedShell = true;
        }
        assert(protectedShell, 'Companion protects GNOME Shell even when called directly');
    }
    await processes.end(row);
    await new Promise(resolve => child.wait_async(null, (proc, result) => {
        proc.wait_finish(result);
        resolve();
    }));
    assert(child.get_if_signaled() && child.get_term_sig() === 15, 'End Task sends SIGTERM to the selected test process');
} finally {
    child.force_exit();
    processes.destroy();
}

const pending = system.getCPUInfo().catch(error => error);
system.destroy();
assert((await pending).matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED),
    'Destroy cancels pending D-Bus calls');
assert(await owner(destination), 'Closing clients leaves the shared collector running');
worker.destroy();
assert(worker._startupTimeout === 0, 'Disable removes sources immediately');
await new Promise(resolve => childWorker.wait_async(null, (proc, result) => {
    proc.wait_finish(result);
    resolve();
}));
assert(childWorker.get_successful(), 'Collector exits cleanly when its stdin closes');
assert(!await owner(destination), 'Disable releases the collector D-Bus connection');
assert(worker._startupTimeout === 0,
    'Collector shutdown removes all lifecycle timeouts');
const restartedWorker = new WorkerClient(extensionPath);
const restarted = new SystemClient(restartedWorker);
assert(typeof await restarted.getUptime() === 'string', 'Collector restarts without an installed service');
restarted.destroy();
const restartedProcess = restartedWorker._process;
restartedWorker.destroy();
await new Promise(resolve => restartedProcess.wait_async(null, (proc, result) => {
    proc.wait_finish(result);
    resolve();
}));
const cancelledWorker = new WorkerClient(extensionPath);
const cancelledProcess = cancelledWorker._process;
cancelledWorker.destroy();
let cancelledStartup = false;
try {
    await cancelledWorker.ready;
} catch (error) {
    cancelledStartup = error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED);
}
assert(cancelledStartup, 'Disable cancels pending collector startup');
await new Promise(resolve => cancelledProcess.wait_async(null, (proc, result) => {
    proc.wait_finish(result);
    resolve();
}));
assert(cancelledProcess.get_successful(), 'Collector disabled during startup still exits cleanly');
const parent = Gio.Subprocess.new([
    'gjs', '-m', GLib.build_filenamev([extensionPath, 'tests', 'worker-parent.js']),
], Gio.SubprocessFlags.STDOUT_PIPE);
const parentOutput = await new Promise((resolve, reject) => {
    parent.communicate_utf8_async(null, null, (proc, result) => {
        try {
            resolve(proc.communicate_utf8_finish(result)[1].trim());
        } catch (error) {
            reject(error);
        }
    });
});
assert(parent.get_successful() && /^:\d+\.\d+$/.test(parentOutput), 'Abrupt parent exit fixture starts its collector');
for (let attempt = 0; attempt < 20 && await owner(parentOutput); attempt++) {
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}
assert(!await owner(parentOutput), 'Collector exits when its parent disappears without destroy');
print(`PASS: ${checks} live D-Bus integration checks`);
