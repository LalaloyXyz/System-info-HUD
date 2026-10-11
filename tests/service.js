// Run in a private dbus-run-session with the companion installed in XDG_DATA_DIRS.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { SystemClient } from '../clients/systemClient.js';
import { ProcessClient } from '../clients/processClient.js';

let checks = 0;
function assert(value, message) {
    checks++;
    if (!value)
        throw new Error(message);
}

async function owner() {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'NameHasOwner',
            new GLib.Variant('(s)', ['io.github.LalaloyXyz.SystemHUD']),
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

assert(!await owner(), 'Companion must start on demand');
const system = new SystemClient();
// The first call tests that the interface is exported before name acquisition.
assert(typeof await system.getUptime() === 'string', 'Cold activation returns uptime');
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

const processes = new ProcessClient();
const child = Gio.Subprocess.new(['sleep', '60'], Gio.SubprocessFlags.NONE);
try {
    const pid = Number(child.get_identifier());
    const [row] = await processes.list(pid);
    assert(row?.pid === pid && row.name === 'sleep', 'Process identity crosses D-Bus');
    const snapshot = await processes.list();
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
await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16000, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
assert(!await owner(), 'Companion exits after its idle timeout');
const restarted = new SystemClient();
assert(typeof await restarted.getUptime() === 'string', 'Companion activates again after idle shutdown');
restarted.destroy();
print(`PASS: ${checks} live D-Bus integration checks`);
