import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SystemLink } from './systemLink.js';
import { UIManager } from './uiManager.js';


export default class SystemHUD extends Extension {
    constructor(metadata) {
        super(metadata);
        this._systemLink = null;
        this._uiManager = null;
    }

    enable() {
        this._systemLink = new SystemLink();
        this._uiManager = new UIManager(this, this._systemLink);
        this._uiManager.createIndicator();
    }

    disable() {
        if (this._uiManager) {
            this._uiManager.destroy();
            this._uiManager = null;
        }
        this._systemLink = null;
    }
} 