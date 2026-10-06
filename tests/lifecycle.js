// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { BaseModule } from '../modules/baseModule.js';
import { ProcessModule } from '../modules/processModule.js';
import { NetworkModule } from '../modules/networkModule.js';

let checks = 0;
function assert(value, message) {
    checks++;
    if (!value)
        throw new Error(message);
}

async function waitForExit(process) {
    await new Promise(resolve => process.wait_async(null, (subprocess, result) => {
        subprocess.wait_finish(result);
        resolve();
    }));
    assert(process.get_if_signaled(), 'Cancelled subprocess must actually exit');
}

const module = new BaseModule();
const pendingCommand = module._executeCommand(['sleep', '30']);
const [[process, timer]] = module._commands;
module.destroy();
assert(!GLib.MainContext.default().find_source_by_id(timer), 'Destroy must remove the command timeout immediately');
assert(await pendingCommand === '', 'Cancelled command returns the existing empty fallback');
await waitForExit(process);
assert(module._commands.size === 0, 'Cancelled command leaves no tracked resources');
assert(await module._executeCommand(['sleep', '30']) === '', 'Destroyed collector cannot start another command');
assert(await module._readFile('/proc/stat') === '', 'Destroyed collector cannot start another read');

const reader = new BaseModule();
const pendingRead = reader._readFile('/proc/stat');
reader.destroy();
assert(await pendingRead === '', 'Pending file read is cancelled');

const processes = new ProcessModule();
const pendingProcess = processes._execute(['sleep', '30']).catch(error => error);
const [child] = processes._subprocesses;
processes.destroy();
assert((await pendingProcess).matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED),
    'Process command rejects on cancellation');
await waitForExit(child);
assert(processes._subprocesses.size === 0, 'Process collector releases its subprocesses');
let rejected = false;
try {
    await processes._execute(['sleep', '30']);
} catch (error) {
    rejected = true;
}
assert(rejected, 'Destroyed process collector cannot spawn again');

const network = new NetworkModule();
network.destroy();
network._ensurePublicIPRefresh();
assert(network._session === null && !network._publicIPInFlight, 'Destroyed network collector cannot restart its request');
print(`PASS: ${checks} lifecycle regression checks`);
