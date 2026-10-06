// Run in a subprocess: walking procfs must not block the Shell UI thread.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const decoder = new TextDecoder();
const processes = {};
for (const pid of ARGV) {
    const clients = {};
    try {
        const directory = Gio.File.new_for_path(`/proc/${pid}/fd`);
        const entries = directory.enumerate_children('standard::name,standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        try {
            let entry;
            while ((entry = entries.next_file(null))) {
                if (!entry.get_symlink_target()?.startsWith('/dev/dri/'))
                    continue;
                try {
                    const [, bytes] = Gio.File.new_for_path(`/proc/${pid}/fdinfo/${entry.get_name()}`).load_contents(null);
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
            entries.close(null);
        }
    } catch (_) {
        // Other users' processes and exited processes may be inaccessible.
    }
    processes[pid] = clients;
}
print(JSON.stringify({ time: GLib.get_monotonic_time() * 1000, processes }));
