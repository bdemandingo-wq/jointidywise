import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ownerChannelMasterOn,
  ownerNativePushAllowed,
  ownerNewBookingEmailAllowed,
  ownerNewBookingSmsAllowed,
} from "./owner-notify-gates.ts";

test("missing prefs send owner email, SMS, and native push", () => {
  assert.equal(ownerNewBookingEmailAllowed({ notifyNewBooking: undefined, channels: null }).allowed, true);
  assert.equal(ownerNewBookingSmsAllowed({ notifyNewBooking: null, channels: undefined }).allowed, true);
  assert.equal(ownerNativePushAllowed(undefined), true);
  assert.equal(ownerNativePushAllowed({}), true);
});

test("notify_new_booking false blocks owner email and SMS while push stays on", () => {
  const email = ownerNewBookingEmailAllowed({ notifyNewBooking: false, channels: {} });
  const sms = ownerNewBookingSmsAllowed({ notifyNewBooking: false, channels: { "master.sms": true } });
  assert.deepEqual(email, { allowed: false, reason: "notify_new_booking" });
  assert.deepEqual(sms, { allowed: false, reason: "notify_new_booking" });
  assert.equal(ownerNativePushAllowed({}), true);
});

test("email master blocks only owner email", () => {
  const channels = { "master.email": false, "master.sms": true, "master.native_push": true };
  assert.deepEqual(
    ownerNewBookingEmailAllowed({ notifyNewBooking: true, channels }),
    { allowed: false, reason: "master.email" },
  );
  assert.equal(ownerNewBookingSmsAllowed({ notifyNewBooking: true, channels }).allowed, true);
  assert.equal(ownerNativePushAllowed(channels), true);
});

test("text master blocks only owner SMS", () => {
  const channels = { "master.sms": false };
  assert.deepEqual(
    ownerNewBookingSmsAllowed({ notifyNewBooking: true, channels }),
    { allowed: false, reason: "master.sms" },
  );
  assert.equal(ownerNewBookingEmailAllowed({ notifyNewBooking: true, channels }).allowed, true);
  assert.equal(ownerNativePushAllowed(channels), true);
});

test("native push master blocks push and leaves email and SMS alone", () => {
  const channels = { "master.native_push": false };
  assert.equal(ownerNativePushAllowed(channels), false);
  assert.equal(ownerNewBookingEmailAllowed({ notifyNewBooking: true, channels }).allowed, true);
  assert.equal(ownerNewBookingSmsAllowed({ notifyNewBooking: true, channels }).allowed, true);
});

test("non-boolean master values stay on", () => {
  const channels = { "master.email": "false", "master.sms": 0, "master.native_push": null };
  assert.equal(ownerChannelMasterOn(channels, "email"), true);
  assert.equal(ownerChannelMasterOn(channels, "sms"), true);
  assert.equal(ownerChannelMasterOn(channels, "native_push"), true);
  assert.equal(ownerChannelMasterOn(["master.email"], "email"), true);
  assert.equal(ownerChannelMasterOn("master.email", "email"), true);
});
