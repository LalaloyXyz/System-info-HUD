import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import { SystemLink } from './systemLink.js';
import { ProcessModule } from './modules/processModule.js';

const busName = 'io.github.LalaloyXyz.SystemHUD';
const interfaceXml = `<node>
    <interface name="${busName}">
        <method name="GetInfo">
            <arg name="module" type="s" direction="in"/>
            <arg name="json" type="s" direction="out"/>
        </method>
        <method name="ListProcesses">
            <arg name="pid" type="u" direction="in"/>
            <arg name="json" type="s" direction="out"/>
        </method>
        <method name="EndProcess">
            <arg name="process" type="s" direction="in"/>
            <arg name="json" type="s" direction="out"/>
        </method>
        <method name="ClearCache">
            <arg name="json" type="s" direction="out"/>
        </method>
    </interface>
</node>`;

export function runService() {
    let InputStream;
    try {
        InputStream = imports.gi.GioUnix.InputStream;
    } catch (_) {
        // GLib versions used by GNOME 45 expose this type through Gio.
        InputStream = Gio.UnixInputStream;
    }

    let system = null;
    let processes = null;
    let exported = null;
    const pending = new Map();
    const app = new (GObject.registerClass(class CompanionApplication extends Gio.Application {
        vfunc_dbus_register(connection, path) {
            const registered = super.vfunc_dbus_register(connection, path);
            if (registered)
                registerService(connection);
            if (registered)
                print(connection.get_unique_name());
            return registered;
        }

        vfunc_startup() {
            super.vfunc_startup();
            this.hold();
            const input = new InputStream({ fd: 0, close_fd: false });
            input.read_bytes_async(1, GLib.PRIORITY_DEFAULT, null, (stream, result) => {
                stream.read_bytes_finish(result);
                this.quit();
            });
        }

        vfunc_dbus_unregister(connection, path) {
            exported?.unexport();
            system?.destroy();
            processes?.destroy();
            pending.clear();
            super.vfunc_dbus_unregister(connection, path);
        }
    }))({
        application_id: busName,
        flags: Gio.ApplicationFlags.NON_UNIQUE | Gio.ApplicationFlags.IS_SERVICE,
    });

    async function reply(invocation, operation) {
        app.hold();
        try {
            const data = await operation();
            invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(data ?? null)]));
        } catch (error) {
            invocation.return_dbus_error(`${busName}.Error`, error.message);
        } finally {
            app.release();
        }
    }

    function registerService(connection) {
        system = new SystemLink();
        processes = new ProcessModule();
        exported = Gio.DBusExportedObject.wrapJSObject(interfaceXml, {
            GetInfoAsync([name], invocation) {
                reply(invocation, async () => {
                    if (name !== 'uptime' && !system.getAvailableModules().includes(name))
                        throw new Error(`Unknown module: ${name}`);
                    if (!pending.has(name)) {
                        const request = name === 'uptime' ? system.getUptime() : system.getModuleInfo(name);
                        pending.set(name, request.finally(() => pending.delete(name)));
                    }
                    return pending.get(name);
                });
            },
            ListProcessesAsync([pid], invocation) {
                reply(invocation, () => processes.list(pid || null));
            },
            EndProcessAsync([json], invocation) {
                reply(invocation, () => processes.end(JSON.parse(json)));
            },
            ClearCacheAsync(_parameters, invocation) {
                reply(invocation, () => system.clearCache());
            },
        });
        exported.export(connection, '/io/github/LalaloyXyz/SystemHUD');
    }

    app.run([]);
}
