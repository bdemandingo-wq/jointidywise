import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runArrivalAttempt, type ArrivalSendResult, type ArrivalStatusRead } from './arrivalAttempt.ts';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('two concurrent updates send arrival once', async () => {
  const claim = { current: false };
  const gate = deferred<ArrivalStatusRead>();
  let sends = 0;
  let stops = 0;
  const actions = {
    onClaimed: () => {},
    onReleased: () => {},
    readStatus: () => gate.promise,
    stopWatch: async () => {
      stops += 1;
    },
    send: async (): Promise<ArrivalSendResult> => {
      sends += 1;
      return { data: { success: true }, error: null };
    },
  };

  const first = runArrivalAttempt(claim, actions);
  const second = runArrivalAttempt(claim, actions);
  assert.equal(claim.current, true);
  gate.resolve({ status: 'confirmed', failed: false });
  const results = await Promise.all([first, second]);

  assert.equal(sends, 1);
  assert.equal(stops, 1);
  const sent = results.filter((row) => (row.data as { success?: boolean; deduplicated?: boolean }).success && !(row.data as { deduplicated?: boolean }).deduplicated);
  const duplicates = results.filter((row) => (row.data as { deduplicated?: boolean }).deduplicated);
  assert.equal(sent.length, 1);
  assert.equal(duplicates.length, 1);
});

test('a finished job stops the watch once and does not send again', async () => {
  const claim = { current: false };
  const gate = deferred<ArrivalStatusRead>();
  let sends = 0;
  let stops = 0;
  const actions = {
    onClaimed: () => {},
    onReleased: () => {},
    readStatus: () => gate.promise,
    stopWatch: async () => {
      stops += 1;
    },
    send: async (): Promise<ArrivalSendResult> => {
      sends += 1;
      return { data: { success: true }, error: null };
    },
  };

  const first = runArrivalAttempt(claim, actions);
  const second = runArrivalAttempt(claim, actions);
  gate.resolve({ status: 'completed', failed: false });
  const [skipped, duplicate] = await Promise.all([first, second]);
  const later = await runArrivalAttempt(claim, {
    ...actions,
    readStatus: async () => ({ status: 'completed', failed: false }),
  });

  assert.equal((skipped.data as { skipped?: boolean }).skipped, true);
  assert.equal((duplicate.data as { deduplicated?: boolean }).deduplicated, true);
  assert.equal((later.data as { deduplicated?: boolean }).deduplicated, true);
  assert.equal(sends, 0);
  assert.equal(stops, 1);
  assert.equal(claim.current, true);
});

test('a failed status read still sends, and only the first of two updates does', async () => {
  const claim = { current: false };
  const gate = deferred<ArrivalStatusRead>();
  let sends = 0;
  const actions = {
    onClaimed: () => {},
    onReleased: () => {},
    readStatus: () => gate.promise,
    stopWatch: async () => {},
    send: async (): Promise<ArrivalSendResult> => {
      sends += 1;
      return { data: { success: true }, error: null };
    },
  };

  const pending = Promise.all([
    runArrivalAttempt(claim, actions),
    runArrivalAttempt(claim, actions),
  ]);
  gate.resolve({ status: null, failed: true });
  await pending;
  assert.equal(sends, 1);
});
