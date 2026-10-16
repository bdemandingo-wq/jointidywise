// node --experimental-strip-types --test src/lib/startupCache.org.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearCachedStartupOrg,
  readStartupSection,
  startupOrgSnapshotIsUsable,
  writeStartupSection,
} from './startupCache.ts';

function installLocalStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

test('sign-in clears the org snapshot and the startup-org query, not the subscription', () => {
  installLocalStorage();
  writeStartupSection('user-1', 'org', {
    organization: null,
    membership: null,
    allOrganizations: [],
    resolution: 'empty',
  });
  writeStartupSection('user-1', 'subscription', { subscribed: true });

  const removed: unknown[] = [];
  clearCachedStartupOrg((filters) => {
    removed.push(filters);
  });

  assert.equal(readStartupSection('user-1', 'org'), null);
  assert.equal(readStartupSection<{ subscribed: boolean }>('user-1', 'subscription')?.value.subscribed, true);
  assert.deepEqual(removed, [{ queryKey: ['startup-org'] }]);
});

test('an empty org snapshot is not usable as the dashboard seed', () => {
  assert.equal(startupOrgSnapshotIsUsable({
    resolution: 'empty',
    organization: null,
  }), false);
  assert.equal(startupOrgSnapshotIsUsable({
    resolution: 'ready',
    organization: null,
  }), false);
  assert.equal(startupOrgSnapshotIsUsable({
    resolution: 'ready',
    organization: { id: 'org-1' },
  }), true);
  assert.equal(startupOrgSnapshotIsUsable(null), false);
});
