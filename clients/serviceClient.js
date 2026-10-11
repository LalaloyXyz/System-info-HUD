import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class ServiceClient {
    constructor() {
        this._cancellable = new Gio.Cancellable();
    }

    async call(method, parameters = null) {
        this._cancellable.set_error_if_cancelled();
        const reply = await new Promise((resolve, reject) => {
            Gio.DBus.session.call('io.github.LalaloyXyz.SystemHUD',
                '/io/github/LalaloyXyz/SystemHUD', 'io.github.LalaloyXyz.SystemHUD',
                method, parameters, new GLib.VariantType('(s)'),
                Gio.DBusCallFlags.NONE, 30000, this._cancellable, (connection, result) => {
                    try {
                        resolve(connection.call_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
        return JSON.parse(reply.deep_unpack()[0]);
    }

    destroy() {
        this._cancellable.cancel();
    }
}
