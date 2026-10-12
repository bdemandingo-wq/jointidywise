import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePushRuntime, holdPlugin, routePushEnable } from './pushRuntime.ts';

const iosFacts = {
  platform: 'ios',
  native: true,
  bridge: true,
  iosShell: true,
  pushHeader: true,
  webNotification: 'absent' as const,
};

test('describePushRuntime keeps the bridge lines and adds permission, status, and error', () => {
  const text = describePushRuntime(iosFacts, {
    permission: 'prompt',
    authorizationStatus: 'notDetermined',
    source: 'NotificationAuth',
    error: 'PushNotifications.requestPermissions() timed out after 10s',
  });
  assert.match(text, /Platform: ios/);
  assert.match(text, /Bridge: connected/);
  assert.match(text, /Push plugin: registered/);
  assert.match(text, /Web Notification: absent/);
  assert.match(text, /Permission: prompt/);
  assert.match(text, /iOS authorization: notDetermined/);
  assert.match(text, /Source: NotificationAuth/);
  assert.match(text, /Error: PushNotifications\.requestPermissions\(\) timed out after 10s/);
});

test('an iOS shell with a bridge still takes the native route', () => {
  assert.deepEqual(routePushEnable(iosFacts), { route: 'native', reason: null });
});

test('returning a Capacitor-style plugin proxy from async hangs; holdPlugin does not', async () => {
  const proxy = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        // Capacitor's method wrapper does not call resolve or reject. The
        // rejection of the inner native call is a different promise, so the
        // await that adopted this proxy stays pending.
        return () => {
          void Promise.reject(new Error('PushNotifications.then() is not implemented on ios')).catch(() => {});
        };
      }
      return undefined;
    },
  });

  const hung = await Promise.race([
    (async () => proxy)(),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 50)),
  ]);
  assert.equal(hung, 'hung');

  const held = await (async () => holdPlugin(proxy))();
  assert.equal(held.plugin, proxy);
});
