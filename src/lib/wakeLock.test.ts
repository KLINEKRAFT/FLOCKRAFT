import { describe, expect, it, vi } from 'vitest';
import { WakeLockManager, type WakeLockSentinelLike } from '@/lib/wakeLock';

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  #listeners: Array<() => void> = [];

  addEventListener(_type: 'release', listener: () => void): void {
    this.#listeners.push(listener);
  }

  async release(): Promise<void> {
    this.released = true;
    for (const listener of this.#listeners) listener();
  }

  /** The browser dropping the lock on its own, as it does when hidden. */
  dropFromBrowser(): void {
    this.released = true;
    for (const listener of this.#listeners) listener();
  }
}

function manager() {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async () => {
    const sentinel = new FakeSentinel();
    sentinels.push(sentinel);
    return sentinel;
  });
  return { manager: new WakeLockManager(request), request, sentinels };
}

describe('WakeLockManager', () => {
  it('holds a lock after acquiring', async () => {
    const { manager: m } = manager();
    await m.acquire();
    expect(m.held).toBe(true);
  });

  it('does not request a second lock while one is held', async () => {
    // The caller re-acquires on every visibility change; stacking sentinels
    // would leak one per flip and none of them would ever be released.
    const { manager: m, request } = manager();
    await m.acquire();
    await m.acquire();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const { manager: m, request } = manager();
    await Promise.all([m.acquire(), m.acquire(), m.acquire()]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('re-acquires after the browser drops the lock', async () => {
    // The case that matters: browsers release the lock when the page is
    // hidden and never restore it. A manager that believed a dead sentinel
    // was still good would leave the screen free to sleep for the rest of
    // the session.
    const { manager: m, request, sentinels } = manager();
    await m.acquire();
    sentinels[0]!.dropFromBrowser();
    expect(m.held).toBe(false);

    await m.acquire();
    expect(request).toHaveBeenCalledTimes(2);
    expect(m.held).toBe(true);
  });

  it('releases the lock', async () => {
    const { manager: m, sentinels } = manager();
    await m.acquire();
    await m.release();
    expect(m.held).toBe(false);
    expect(sentinels[0]!.released).toBe(true);
  });

  it('releases a lock that arrived after the caller gave up', async () => {
    // `release` can land while the request is still in flight — pausing
    // immediately after starting. Without this the screen would be pinned
    // awake by a sentinel nothing holds a reference to.
    const { manager: m, sentinels } = manager();
    const pending = m.acquire();
    await m.release();
    await pending;
    expect(m.held).toBe(false);
    expect(sentinels[0]!.released).toBe(true);
  });

  it('survives a refused request', async () => {
    // Browsers reject when the document is hidden or battery saver is on.
    // Recording must not care.
    const request = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    const m = new WakeLockManager(request);
    await expect(m.acquire()).resolves.toBeUndefined();
    expect(m.held).toBe(false);
  });

  it('retries after a refusal rather than latching off', async () => {
    let calls = 0;
    const request = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('NotAllowedError');
      return new FakeSentinel();
    });
    const m = new WakeLockManager(request);
    await m.acquire();
    await m.acquire();
    expect(m.held).toBe(true);
  });

  it('is inert where the API does not exist', async () => {
    // iOS below 16.4. The app still runs; it simply cannot hold the screen.
    const m = new WakeLockManager(null);
    expect(m.supported).toBe(false);
    await expect(m.acquire()).resolves.toBeUndefined();
    await expect(m.release()).resolves.toBeUndefined();
    expect(m.held).toBe(false);
  });

  it('release is safe before anything was acquired', async () => {
    const { manager: m } = manager();
    await expect(m.release()).resolves.toBeUndefined();
  });
});
