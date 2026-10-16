import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRegistrationRace } from './pushRegistrationRace.ts';

test('the first real token wins and a later listener is ignored', () => {
  const race = createRegistrationRace();
  assert.equal(race.finish('direct-token'), true);
  assert.equal(race.finish('listener-token'), false);
  assert.equal(race.fail(), false);
});

test('an empty NotificationAuth result does not block the registration listener', () => {
  const race = createRegistrationRace();
  assert.equal(race.finish(''), false);
  assert.equal(race.finish('listener-token'), true);
  assert.equal(race.finish('late-token'), false);
});

test('a registration failure settles the race before a late token', () => {
  const race = createRegistrationRace();
  assert.equal(race.fail(), true);
  assert.equal(race.finish('late-token'), false);
  assert.equal(race.fail(), false);
});
