import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStoragePersisted, requestPersistentStorage } from '@/lib/storagePersistence';

function withStorage(storage: unknown) {
  vi.stubGlobal('navigator', { storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPersistentStorage', () => {
  it('reports unsupported where the API is absent', async () => {
    withStorage(undefined);
    expect(await requestPersistentStorage()).toBe('unsupported');
  });

  it('grants when the browser agrees', async () => {
    withStorage({ persisted: async () => false, persist: async () => true });
    expect(await requestPersistentStorage()).toBe('persisted');
  });

  it('reports best-effort when the browser refuses', async () => {
    // Chrome refuses until the origin earns enough engagement. The record is
    // then evictable, and the privacy screen says so rather than implying a
    // durability guarantee that does not exist.
    withStorage({ persisted: async () => false, persist: async () => false });
    expect(await requestPersistentStorage()).toBe('best-effort');
  });

  it('does not re-ask once the grant is already held', async () => {
    // Some browsers count repeated prompts against the origin, and this runs
    // on every load.
    const persist = vi.fn(async () => true);
    withStorage({ persisted: async () => true, persist });
    expect(await requestPersistentStorage()).toBe('persisted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('swallows a throwing implementation', async () => {
    // Private browsing modes throw here. Recording must not be blocked by a
    // failed durability request.
    withStorage({
      persisted: async () => {
        throw new Error('SecurityError');
      },
      persist: async () => true,
    });
    expect(await requestPersistentStorage()).toBe('unsupported');
  });
});

describe('isStoragePersisted', () => {
  it('is undefined when the browser will not say', async () => {
    // Distinct from `false`: "evictable" and "unknown" must not render the
    // same way on a screen an operator uses to decide whether to export.
    withStorage({});
    expect(await isStoragePersisted()).toBeUndefined();
  });

  it('reports the standing grant without asking for one', async () => {
    const persist = vi.fn(async () => true);
    withStorage({ persisted: async () => true, persist });
    expect(await isStoragePersisted()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('is undefined when the check throws', async () => {
    withStorage({
      persisted: async () => {
        throw new Error('SecurityError');
      },
    });
    expect(await isStoragePersisted()).toBeUndefined();
  });
});
