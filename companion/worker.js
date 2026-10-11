import GLib from 'gi://GLib';
import { runService } from './service.js';

if (GLib.getenv('SYSTEMHUD_WORKER') === '1')
    runService();
