import { describe, expect, it } from 'vitest';
import { shouldResumeCamera, type CameraResumeState } from '@/lib/cameraLifecycle';

const state = (patch: Partial<CameraResumeState> = {}): CameraResumeState => ({
  wanted: true,
  hasStream: false,
  starting: false,
  visible: true,
  denied: false,
  ...patch,
});

describe('shouldResumeCamera', () => {
  it('resumes a wanted camera the platform released', () => {
    // The exact shape of the bug: iOS stops the track on screen sleep, the
    // page comes back, and nothing restarts it.
    expect(shouldResumeCamera(state())).toBe(true);
  });

  it('does not resume a camera the operator stopped', () => {
    // The property that keeps this from being obnoxious. Pressing stop must
    // mean stopped, not stopped-until-you-switch-apps.
    expect(shouldResumeCamera(state({ wanted: false }))).toBe(false);
  });

  it('does nothing when a stream is already attached', () => {
    // `pageshow` and `visibilitychange` can both fire for one return; the
    // second must not tear down a working stream to rebuild it.
    expect(shouldResumeCamera(state({ hasStream: true }))).toBe(false);
  });

  it('waits until the page is actually visible', () => {
    // getUserMedia is refused for a hidden document, and a failed attempt
    // would leave the status showing an error the operator never caused.
    expect(shouldResumeCamera(state({ visible: false }))).toBe(false);
  });

  it('does not launch a second request while one is in flight', () => {
    // A page restored from the back/forward cache fires `pageshow` and
    // `visibilitychange` back to back. iOS permits one live camera track, so
    // the second request would orphan the first stream — the indicator stays
    // lit and nothing is reading the feed.
    expect(shouldResumeCamera(state({ starting: true }))).toBe(false);
  });

  it('never re-prompts after a denial', () => {
    // Retrying a denied permission on every app switch is how an app gets
    // its camera access permanently blocked.
    expect(shouldResumeCamera(state({ denied: true }))).toBe(false);
  });

  it('stays false when the operator stopped a camera that is also denied', () => {
    expect(shouldResumeCamera(state({ wanted: false, denied: true }))).toBe(false);
  });
});
