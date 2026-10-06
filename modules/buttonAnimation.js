import Clutter from 'gi://Clutter';

export function addButtonAnimation(button, animationsEnabled) {
    button.set_pivot_point(0.5, 0.5);
    button.track_hover = true;
    const update = () => {
        if (!animationsEnabled() || !button.reactive || !button.mapped) {
            button.remove_transition('scale-x');
            button.remove_transition('scale-y');
            button.set_scale(1, 1);
            return;
        }
        const scale = button.pressed ? 0.96 : button.hover ? 1.02 : 1;
        button.ease({
            scale_x: scale,
            scale_y: scale,
            duration: button.pressed ? 90 : 200,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    };
    for (const property of ['pressed', 'hover', 'reactive', 'mapped'])
        button.connect(`notify::${property}`, update);
}
