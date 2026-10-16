// node --experimental-strip-types --test src/lib/provisionTrialOrg.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createInFlightGate,
  shouldInsertTrialOrg,
  workspaceToReuse,
} from '../../supabase/functions/_shared/provision-trial-org.ts';
import { provisionTrialOrgIfMissing } from './provisionTrialOrg.ts';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('a membership or an owned org is reused and no insert is allowed', () => {
  assert.equal(workspaceToReuse({ membershipOrgId: 'mem', ownedOrgId: 'owned' }), 'mem');
  assert.equal(workspaceToReuse({ membershipOrgId: null, ownedOrgId: 'owned' }), 'owned');
  assert.equal(workspaceToReuse({ membershipOrgId: '  ', ownedOrgId: '' }), null);
  assert.equal(shouldInsertTrialOrg({ membershipOrgId: null, ownedOrgId: null }), true);
  assert.equal(shouldInsertTrialOrg({ ownedOrgId: 'owned' }), false);
});

test('concurrent provisions for one user invoke the insert once', async () => {
  const gate = createInFlightGate<string>();
  let inserts = 0;
  const insert = () => gate.run('user-1', async () => {
    inserts += 1;
    await delay(15);
    return 'org-new';
  });
  const [first, second] = await Promise.all([insert(), insert()]);
  assert.equal(inserts, 1);
  assert.equal(first, 'org-new');
  assert.equal(second, 'org-new');

  const third = await gate.run('user-1', async () => {
    inserts += 1;
    return 'org-later';
  });
  assert.equal(inserts, 2);
  assert.equal(third, 'org-later');
});

test('a second signup call waits and does not insert when the first is in flight', async () => {
  let lookups = 0;
  let invokes = 0;
  const attempt = {
    userId: 'signup-user',
    lookup: async () => {
      lookups += 1;
      await delay(20);
      return { probe: { membershipOrgId: null, ownedOrgId: null }, error: null };
    },
    invoke: async () => {
      invokes += 1;
      return { organizationId: 'org-placeholder', error: null };
    },
  };
  const [first, second] = await Promise.all([
    provisionTrialOrgIfMissing(attempt),
    provisionTrialOrgIfMissing(attempt),
  ]);
  assert.equal(lookups, 1);
  assert.equal(invokes, 1);
  assert.deepEqual(first, { organizationId: 'org-placeholder', created: true });
  assert.deepEqual(second, { organizationId: 'org-placeholder', created: true });
});

test('the re-check skips the insert when a workspace already exists', async () => {
  const owned = await provisionTrialOrgIfMissing({
    userId: 'already-owns',
    lookup: async () => ({ probe: { membershipOrgId: null, ownedOrgId: 'org-owned' }, error: null }),
    invoke: async () => {
      throw new Error('insert should not run');
    },
  });
  assert.deepEqual(owned, { organizationId: 'org-owned', created: false });

  const member = await provisionTrialOrgIfMissing({
    userId: 'already-member',
    lookup: async () => ({ probe: { membershipOrgId: 'org-member', ownedOrgId: null }, error: null }),
    invoke: async () => {
      throw new Error('insert should not run');
    },
  });
  assert.deepEqual(member, { organizationId: 'org-member', created: false });
});

test('a lookup failure does not insert', async () => {
  let invokes = 0;
  await assert.rejects(
    () => provisionTrialOrgIfMissing({
      userId: 'lookup-failed',
      lookup: async () => ({ probe: {}, error: new Error('membership read failed') }),
      invoke: async () => {
        invokes += 1;
        return { organizationId: 'nope', error: null };
      },
    }),
    /membership read failed/,
  );
  assert.equal(invokes, 0);
});

test('provision-trial-org re-checks immediately before the placeholder insert', () => {
  const source = readFileSync(
    new URL('../../supabase/functions/provision-trial-org/index.ts', import.meta.url),
    'utf8',
  );
  const recheck = source.indexOf('const raced = await lookupWorkspace(user.id)');
  const insert = source.indexOf('.insert({ name: orgName, plan_type: "trial"');
  assert.ok(recheck > 0, 'missing pre-insert re-check');
  assert.ok(insert > recheck, 'insert runs before the re-check');
  assert.match(source, /provisionGate\.run\(user\.id/);
  assert.match(source, /needs_onboarding: true/);
});
