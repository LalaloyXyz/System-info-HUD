import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SystemClient } from './clients/systemClient.js';
import { WorkerClient } from './clients/workerClient.js';
import { UIManager } from './ui/uiManager.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


export default class SystemHUD extends Extension {
    constructor(metadata) {
        super(metadata);
        this._systemLink = null;
        this._worker = null;
        this._uiManager = null;
    }

    enable() {
        this._worker = new WorkerClient(this.path);
        this._systemLink = new SystemClient(this._worker);
        this._uiManager = new UIManager(this, this._systemLink);
        this._uiManager.createIndicator();
        const systemLink = this._systemLink;
        systemLink.getUptime().catch(error => {
            if (this._systemLink === systemLink)
                Main.notify('System HUD', `${error.message}\n${this.metadata.url}`);
        });
    }

    disable() {
        if (this._uiManager) {
            this._uiManager.destroy();
            this._uiManager = null;
        }
        if (this._systemLink) {
            this._systemLink.destroy();
            this._systemLink = null;
        }
        this._worker?.destroy();
        this._worker = null;
    }
}
