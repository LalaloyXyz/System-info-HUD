import St from 'gi://St';
import Clutter from 'gi://Clutter';

// St.BoxLayout used the vertical property before the orientation API.
const hasOrientation = typeof St.BoxLayout.prototype.set_orientation === 'function';
export const verticalBox = hasOrientation ? { orientation: Clutter.Orientation.VERTICAL } : { vertical: true };
export const horizontalBox = hasOrientation ? { orientation: Clutter.Orientation.HORIZONTAL } : { vertical: false };
