// Runs only in the companion service, outside the Shell UI thread.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export async function collectProcessGpu(pids, cancellable) {
    Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
    Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
    Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
    Gio._promisify(Gio.FileEnumerator.prototype, 'close_async', 'close_finish');

    const decoder = new TextDecoder();
    const processes = {};
    for (const pid of pids) {
        cancellable.set_error_if_cancelled();
        const clients = {};
        try {
            const directory = Gio.File.new_for_path(`/proc/${pid}/fd`);
            const entries = await directory.enumerate_children_async('standard::name,standard::symlink-target',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable);
            try {
                while (true) {
                    const [entry] = await entries.next_files_async(1, GLib.PRIORITY_DEFAULT, cancellable);
                    if (!entry)
                        break;
                    if (!entry.has_attribute('standard::symlink-target') ||
                        !entry.get_symlink_target()?.startsWith('/dev/dri/'))
                        continue;
                    try {
                        const [bytes] = await Gio.File.new_for_path(`/proc/${pid}/fdinfo/${entry.get_name()}`).load_contents_async(cancellable);
                        const content = decoder.decode(bytes);
                        const id = content.match(/^drm-client-id:\s*(\d+)/m)?.[1];
                        if (!id)
                            continue;
                        const device = content.match(/^drm-pdev:\s*(\S+)/m)?.[1] ??
                            content.match(/^drm-driver:\s*(\S+)/m)?.[1];
                        const engines = {};
                        for (const match of content.matchAll(/^drm-engine-([^:\s]+):\s*(\d+)\s+ns/gm)) {
                            const capacity = Number(content.match(new RegExp(`^drm-engine-capacity-${match[1]}:\\s*(\\d+)`, 'm'))?.[1] ?? 1);
                            engines[match[1]] = { time: Number(match[2]), capacity };
                        }
                        if (Object.keys(engines).length)
                            clients[`${device}:${id}`] = { device, engines };
                    } catch (_) {
                        // A descriptor may close while the snapshot is being collected.
                    }
                }
            } finally {
                await entries.close_async(GLib.PRIORITY_DEFAULT, null);
            }
        } catch (_) {
            // Other users' processes and exited processes may be inaccessible.
        }
        processes[pid] = clients;
    }
    cancellable.set_error_if_cancelled();
    return { time: GLib.get_monotonic_time() * 1000, processes };
}
