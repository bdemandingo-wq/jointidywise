// node --experimental-strip-types --test src/lib/orgBundleResolution.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EMPTY_ORG_RETRY_MS,
  OrgSessionNotAttachedError,
  assertSessionMatchesUser,
  joinMembershipsToOrgs,
  resolveEmptyOrgRead,
  shouldCacheOrgBundle,
} from './orgBundleResolution.ts';

const USER = 'user-1';

test('a session that is not this user throws before an empty read is trusted', async () => {
  let loads = 0;
  await assert.rejects(
    () => resolveEmptyOrgRead({
      userId: USER,
      load: async () => {
        loads += 1;
        return [];
      },
      readSessionUserId: async () => null,
      sleep: async () => {
        throw new Error('should not wait on a missing session');
      },
    }),
    OrgSessionNotAttachedError,
  );
  assert.equal(loads, 1);
});

test('an empty read is tried once more after 500ms when the session matches', async () => {
  const sleeps: number[] = [];
  let loads = 0;
  const rows = await resolveEmptyOrgRead({
    userId: USER,
    load: async () => {
      loads += 1;
      return loads === 1 ? [] : [{ id: 'org-1' }];
    },
    readSessionUserId: async () => USER,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.deepEqual(sleeps, [EMPTY_ORG_RETRY_MS]);
  assert.equal(EMPTY_ORG_RETRY_MS, 500);
  assert.deepEqual(rows, [{ id: 'org-1' }]);
  assert.equal(loads, 2);
});

test('a confirmed empty account is returned only after the session matches twice', async () => {
  let sessionReads = 0;
  const rows = await resolveEmptyOrgRead({
    userId: USER,
    load: async () => [],
    readSessionUserId: async () => {
      sessionReads += 1;
      return USER;
    },
    sleep: async () => {},
  });
  assert.deepEqual(rows, []);
  assert.equal(sessionReads, 2);
});

test('the session is checked again after the retry before an empty result is trusted', async () => {
  let sessionReads = 0;
  await assert.rejects(
    () => resolveEmptyOrgRead({
      userId: USER,
      load: async () => [],
      readSessionUserId: async () => {
        sessionReads += 1;
        return sessionReads === 1 ? USER : null;
      },
      sleep: async () => {},
    }),
    OrgSessionNotAttachedError,
  );
  assert.equal(sessionReads, 2);
});

test('a non-empty read does not wait or check the session', async () => {
  const rows = await resolveEmptyOrgRead({
    userId: USER,
    load: async () => [{ id: 'org-1' }],
    readSessionUserId: async () => {
      throw new Error('session should not be read');
    },
    sleep: async () => {
      throw new Error('should not sleep');
    },
  });
  assert.deepEqual(rows, [{ id: 'org-1' }]);
});

test('assertSessionMatchesUser rejects a missing or different user', () => {
  assert.doesNotThrow(() => assertSessionMatchesUser(USER, USER));
  assert.throws(() => assertSessionMatchesUser(null, USER), OrgSessionNotAttachedError);
  assert.throws(() => assertSessionMatchesUser('other', USER), OrgSessionNotAttachedError);
});

test('memberships with no org rows are an error, not an empty account', () => {
  assert.deepEqual(joinMembershipsToOrgs([], [{ id: 'org-1' }]), []);
  assert.throws(
    () => joinMembershipsToOrgs(
      [{ organization_id: 'org-1', role: 'owner' }],
      [],
    ),
    /no organizations were returned/,
  );
  assert.deepEqual(
    joinMembershipsToOrgs(
      [
        { organization_id: 'org-1', role: 'owner' },
        { organization_id: 'org-missing', role: 'admin' },
      ],
      [{ id: 'org-1', name: 'Sparkle' }],
    ),
    [{ organization: { id: 'org-1', name: 'Sparkle' }, role: 'owner' }],
  );
});

test('only a ready bundle is cached', () => {
  assert.equal(shouldCacheOrgBundle('ready'), true);
  assert.equal(shouldCacheOrgBundle('empty'), false);
  assert.equal(shouldCacheOrgBundle('error'), false);
});

test('fetchOrgBundle uses the empty-read guard and caches only a ready result', () => {
  const source = readFileSync(new URL('./fetchOrgBundle.ts', import.meta.url), 'utf8');
  const resolveAt = source.indexOf('resolveEmptyOrgRead');
  const cacheAt = source.indexOf('shouldCacheOrgBundle');
  assert.ok(resolveAt > 0);
  assert.ok(cacheAt > resolveAt);
  assert.equal(source.includes("resolution !== 'error'"), false);
});
