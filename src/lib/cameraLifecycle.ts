/**
 * CAMERA LIFECYCLE RULES
 * ---------------------------------------------------------------------------
 * The one decision that decides whether a long session survives.
 *
 * Mobile Safari stops camera tracks and freezes the page when the screen
 * sleeps, a call arrives, or another app comes forward. Releasing the camera
 * there is correct — a stopped track is what turns the recording indicator off
 * and stops drawing power. What was missing is the other half: coming back.
 *
 * The distinction this file draws is between *released* and *stopped*.
 * Releasing is something the platform did to us and should be undone the moment
 * the page is visible again. Stopping is something the operator asked for and
 * must never be undone behind their back. Collapsing the two is what made a
 * drive record for thirty seconds and then sit on "Camera standby" for an hour.
 */

export interface CameraResumeState {
  /** The operator started the camera and has not stopped it. */
  wanted: boolean;
  /** A live `MediaStream` is currently attached. */
  hasStream: boolean;
  /**
   * A `getUserMedia` call is already in flight. Restoring a page fires
   * `pageshow` and `visibilitychange` back to back, and iOS permits one live
   * track: a second request launched into that window orphans the first
   * stream, leaving the camera indicator lit with nothing reading it.
   */
  starting: boolean;
  /** The document is currently visible. */
  visible: boolean;
  /** Permission was refused — retrying would only re-prompt, so it does not. */
  denied: boolean;
}

export function shouldResumeCamera(state: CameraResumeState): boolean {
  if (!state.wanted || state.denied) return false;
  if (state.hasStream || state.starting) return false;
  return state.visible;
}
