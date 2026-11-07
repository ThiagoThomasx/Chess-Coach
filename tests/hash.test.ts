import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../src/utils/hash';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId (Sprint 3.1)', () => {
  it('returns a v4 UUID in a secure context', () => {
    expect(newId()).toMatch(UUID_V4);
  });

  // Browsers expose crypto.randomUUID only in secure contexts (HTTPS, localhost).
  // Opening the app from a phone at http://<LAN IP>:port has getRandomValues but no randomUUID.
  it('still returns unique v4 UUIDs on a plain-HTTP LAN origin (no crypto.randomUUID)', () => {
    const { getRandomValues } = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: getRandomValues.bind(globalThis.crypto) });
    const ids = Array.from({ length: 200 }, () => newId());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
