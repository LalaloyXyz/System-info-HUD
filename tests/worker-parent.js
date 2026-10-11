import GLib from 'gi://GLib';
import System from 'system';
import { WorkerClient } from '../clients/workerClient.js';

const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
const worker = new WorkerClient(root);
print(await worker.ready);
// Exit without destroy() to exercise the collector's parent-loss cleanup.
System.exit(0);
