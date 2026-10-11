import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ServiceClient } from './serviceClient.js';

export class ProcessClient extends ServiceClient {
    constructor(worker) {
        super(worker);
        const credentials = new Gio.Credentials();
        this._uid = credentials.get_unix_user();
        this._pid = credentials.get_unix_pid();
    }

    list(pid = null) {
        return this.call('ListProcesses', new GLib.Variant('(u)', [pid ?? 0]));
    }

    canEnd(process) {
        return process.pid > 1 && process.pid !== this._pid &&
            process.uid === this._uid && process.name !== 'gnome-shell';
    }

    async end(process) {
        if (!this.canEnd(process))
            throw new Error('This process cannot be ended from the HUD.');
        await this.call('EndProcess', new GLib.Variant('(s)', [JSON.stringify(process)]));
    }
}
