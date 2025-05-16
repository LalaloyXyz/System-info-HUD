import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SystemInfoCollector } from './systemInfoCollector.js';
import { UIManager } from './uiManager.js';


export default class SystemHUD extends Extension {
    constructor(metadata) {
        super(metadata);
        this._systemInfoCollector = null;
        this._uiManager = null;
    }

    enable() {
        this._systemInfoCollector = new SystemInfoCollector();
        this._uiManager = new UIManager(this, this._systemInfoCollector);
        this._uiManager.createIndicator();
    }

    disable() {
        if (this._uiManager) {
            this._uiManager.destroyMainScreen();
            this._uiManager = null;
        }
        this._systemInfoCollector = null;
    }
} 