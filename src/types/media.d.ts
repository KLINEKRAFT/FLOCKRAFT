/**
 * Ambient augmentation for camera capabilities that ship in browsers but are
 * absent from the DOM typings.
 *
 * `torch` and `zoom` are part of the MediaStream Image Capture specification
 * and are implemented on Android Chrome and iOS Safari, but TypeScript's `lib.dom`
 * does not declare them. Declaring them here keeps the call sites honest —
 * optional, correctly typed, and guarded by a `getCapabilities()` check —
 * instead of scattering `as never` casts through the camera hook.
 */
interface MediaTrackConstraintSet {
  torch?: ConstrainBoolean;
  zoom?: ConstrainDouble;
}

interface MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
}

interface MediaTrackSettings {
  torch?: boolean;
  zoom?: number;
}
