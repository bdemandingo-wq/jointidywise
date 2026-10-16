import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  notifyOwner,
  ownerAlertBellOn,
  ownerAlertDedupeKey,
  ownerAlertEmailAllowed,
  ownerAlertPushOn,
  ownerAlertNeedsEmail,
  openPhoneFromId,
  ownerAlertPhones,
  ownerAlertSmsAllowed,
  type OwnerAlertContext,
  type OwnerAlertDeps,
  type OwnerAlertOrg,
} from "./owner-alert.ts";

const originalFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = () => {
    throw new Error("notifyOwner test tried to send a real request");
  };
});
test.after(() => {
  globalThis.fetch = originalFetch;
});

const org: OwnerAlertOrg = {
  supabase: { from: () => { throw new Error("supabase should be mocked via load"); } },
  organizationId: "org-1",
  bookingId: "booking-1",
};

function context(over: Partial<OwnerAlertContext> = {}): OwnerAlertContext {
  return {
    matrix: {},
    channels: {},
    snoozedUntil: {},
    notificationPhone: "+15551110001, 5551110002",
    companyPhone: "5559990000",
    emailTo: "owner@example.com",
    smsEnabled: true,
    openPhoneApiKey: "op-key",
    openPhoneFrom: "PN123",
    operatorIosTokens: 2,
    ...over,
  };
}

function harness(ctx: OwnerAlertContext, office?: { bell?: boolean; push?: boolean; duplicate?: boolean }) {
  const sms: Array<{ phones: string[]; content: string }> = [];
  const email: Array<{ to: string; subject: string }> = [];
  const officeCalls: Array<{
    dedupeKey?: string;
    type?: string;
    organizationId: string;
    sendPush?: boolean;
    writeBell?: boolean;
  }> = [];
  const deps: Partial<OwnerAlertDeps> = {
    load: async () => ctx,
    notifyOffice: async (_supabase, args) => {
      officeCalls.push({
        dedupeKey: args.dedupeKey,
        type: args.type,
        organizationId: args.organizationId,
        sendPush: args.sendPush !== false,
        writeBell: args.writeBell !== false,
      });
      return {
        bell: args.writeBell === false ? false : (office?.bell ?? true),
        push: args.sendPush === false ? false : (office?.push ?? true),
        duplicate: office?.duplicate ?? false,
      };
    },
    sendSms: async (args) => {
      sms.push({ phones: args.phones, content: args.content });
      return { sent: args.phones.length };
    },
    sendEmail: async (args) => {
      email.push({ to: args.to, subject: args.subject });
      return { success: true };
    },
  };
  return { deps, sms, email, officeCalls };
}

test("operator push goes through notifyOffice, which targets operator devices", () => {
  const source = readFileSync(new URL("./office-notify.ts", import.meta.url), "utf8");
  assert.match(source, /audience:\s*"operators"/);
});

test("dedupe key includes the cleaner or the cancellation", () => {
  assert.equal(ownerAlertDedupeKey("booking.new", "booking-1"), "booking.new:booking-1");
  assert.equal(ownerAlertDedupeKey("job.arrived", null), undefined);
  assert.equal(
    ownerAlertDedupeKey("job.on_the_way", "booking-1", { staffId: "staff-9" }),
    "job.on_the_way:booking-1:staff-9",
  );
  assert.equal(
    ownerAlertDedupeKey("job.arrived", "booking-1", { staffId: "staff-2" }),
    "job.arrived:booking-1:staff-2",
  );
  assert.equal(
    ownerAlertDedupeKey("job.completed", "booking-1", { staffId: "staff-2" }),
    "job.completed:booking-1:staff-2",
  );
  assert.equal(ownerAlertDedupeKey("booking.cancelled", "booking-1"), undefined);
  assert.equal(
    ownerAlertDedupeKey("booking.cancelled", "booking-1", { occurrenceId: "2026-10-16T15:00:00.000Z" }),
    "booking.cancelled:booking-1:2026-10-16T15:00:00.000Z",
  );
});

test("bell and push follow the group switch and snooze", () => {
  const off = {
    bell: false,
    native_push: false,
    email: false,
    sms: false,
  };
  assert.equal(ownerAlertBellOn({
    eventKey: "job.arrived",
    matrix: { "job.arrived": off },
    snoozedUntil: {},
  }), false);
  assert.equal(ownerAlertPushOn({
    eventKey: "job.arrived",
    matrix: { "job.arrived": off },
    channels: {},
    snoozedUntil: {},
  }), false);
  assert.equal(ownerAlertBellOn({
    eventKey: "booking.new",
    matrix: {},
    snoozedUntil: {},
  }), false);
  const until = new Date(Date.now() + 60_000).toISOString();
  assert.equal(ownerAlertPushOn({
    eventKey: "job.completed",
    matrix: {},
    channels: {},
    snoozedUntil: { "job.completed": until },
  }), false);
  assert.equal(ownerAlertPushOn({
    eventKey: "job.completed",
    matrix: {},
    channels: { "master.native_push": false },
    snoozedUntil: {},
  }), false);
  assert.equal(ownerAlertPushOn({
    eventKey: "job.completed",
    matrix: {},
    channels: {},
    snoozedUntil: {},
  }), true);
});

test("SMS stays off unless this event opted in and SMS is enabled", () => {
  assert.equal(ownerAlertSmsAllowed({ eventKey: "booking.new", matrix: {}, channels: {}, smsEnabled: true }), false);
  assert.equal(ownerAlertSmsAllowed({
    eventKey: "booking.new",
    matrix: { "booking.new": { sms: false } },
    channels: {},
    smsEnabled: true,
  }), false);
  assert.equal(ownerAlertSmsAllowed({
    eventKey: "booking.new",
    matrix: { "booking.new": { sms: true } },
    channels: {},
    smsEnabled: false,
  }), false);
  assert.equal(ownerAlertSmsAllowed({
    eventKey: "booking.new",
    matrix: { "booking.new": { sms: true } },
    channels: { "master.sms": false },
    smsEnabled: true,
  }), false);
  assert.equal(ownerAlertSmsAllowed({
    eventKey: "booking.new",
    matrix: { "booking.new": { sms: true } },
    channels: {},
    smsEnabled: true,
  }), true);
});

test("email is the fallback when there is no operator iPhone or push delivered nothing", () => {
  assert.equal(ownerAlertNeedsEmail(0, true), true);
  assert.equal(ownerAlertNeedsEmail(3, false), true);
  assert.equal(ownerAlertNeedsEmail(3, true), false);
  assert.equal(ownerAlertEmailAllowed({
    eventKey: "job.completed",
    matrix: {},
    channels: {},
    snoozedUntil: {},
  }), true);
  assert.equal(ownerAlertEmailAllowed({
    eventKey: "job.completed",
    matrix: { "job.completed": { email: false } },
    channels: {},
    snoozedUntil: {},
  }), false);
  assert.equal(ownerAlertEmailAllowed({
    eventKey: "booking.new",
    matrix: { "booking.new": { email: true } },
    channels: { "master.email": false },
    snoozedUntil: {},
  }), false);
});

test("openPhoneFromId reads phone-numbers and inbox URLs", () => {
  assert.equal(openPhoneFromId("PNabc"), "PNabc");
  assert.equal(openPhoneFromId("https://my.openphone.com/settings/phone-numbers/PNabc"), "PNabc");
  assert.equal(openPhoneFromId("https://my.openphone.com/inbox/PNinbox"), "PNinbox");
  assert.equal(openPhoneFromId("https://my.openphone.com/inbox/ID123"), "ID123");
  assert.equal(openPhoneFromId("  "), "");
  assert.equal(openPhoneFromId(null), "");
});

test("alert phones use every personal number and fall back to the company line", () => {
  assert.deepEqual(ownerAlertPhones("5551110001, 555-111-0002", "5559990000"), ["+15551110001", "+15551110002"]);
  assert.deepEqual(ownerAlertPhones("  ", "(555) 999-0000"), ["+15559990000"]);
  assert.deepEqual(ownerAlertPhones(null, null), []);
});

test("notifyOwner writes the bell and does not text or email when push lands", async () => {
  const { deps, sms, email, officeCalls } = harness(context(), { push: true });
  const result = await notifyOwner(
    { ...org, staffId: "staff-9" },
    "job.arrived",
    {
      title: "Arrived",
      body: "Sam arrived",
      link: "/dashboard/bookings",
    },
    deps,
  );

  assert.equal(result.bell, true);
  assert.equal(result.push, true);
  assert.equal(result.sms, false);
  assert.equal(result.email, false);
  assert.deepEqual(sms, []);
  assert.deepEqual(email, []);
  assert.equal(officeCalls[0]?.type, "job.arrived");
  assert.equal(officeCalls[0]?.dedupeKey, "job.arrived:booking-1:staff-9");
  assert.equal(officeCalls[0]?.organizationId, "org-1");
  assert.equal(officeCalls[0]?.sendPush, true);
});

test("booking.new does not add a second bell row and still pushes", async () => {
  const { deps, officeCalls } = harness(context(), { push: true });
  const result = await notifyOwner(org, "booking.new", {
    title: "New booking",
    body: "Alex booked a clean",
  }, deps);
  assert.equal(result.bell, false);
  assert.equal(result.push, true);
  assert.equal(officeCalls[0]?.writeBell, true);
  assert.equal(officeCalls[0]?.dedupeKey, "booking.new:booking-1");
});

test("notifyOwner texts every alert number only when Also text me is on", async () => {
  const optedIn = context({
    matrix: { "job.on_the_way": { sms: true } },
    operatorIosTokens: 1,
  });
  const { deps, sms, email } = harness(optedIn, { push: true });
  const result = await notifyOwner(org, "job.on_the_way", {
    title: "On the way",
    body: "Sam is on the way",
  }, deps);

  assert.equal(result.sms, true);
  assert.equal(result.email, false);
  assert.deepEqual(sms, [{ phones: ["+15551110001", "+15551110002"], content: "Sam is on the way" }]);
  assert.deepEqual(email, []);
});

test("notifyOwner falls back to the company phone for an opted-in text", async () => {
  const { deps, sms } = harness(context({
    matrix: { "booking.cancelled": { sms: true } },
    notificationPhone: null,
    operatorIosTokens: 1,
  }), { push: true });
  const result = await notifyOwner(org, "booking.cancelled", {
    title: "Cancelled",
    body: "Booking cancelled",
  }, deps);
  assert.equal(result.sms, true);
  assert.deepEqual(sms[0]?.phones, ["+15559990000"]);
});

test("notifyOwner emails when no operator iPhone is registered", async () => {
  const { deps, sms, email } = harness(context({ operatorIosTokens: 0 }), { push: true });
  const result = await notifyOwner(org, "client.portal_request", {
    title: "Portal request",
    body: "Jamie asked for Friday",
    link: "/dashboard/client-portal",
  }, deps);
  assert.equal(result.sms, false);
  assert.equal(result.email, true);
  assert.deepEqual(sms, []);
  assert.deepEqual(email, [{ to: "owner@example.com", subject: "Portal request" }]);
});

test("notifyOwner emails when push delivered zero", async () => {
  const { deps, email } = harness(context({ operatorIosTokens: 4 }), { push: false });
  const result = await notifyOwner(org, "job.arrived", {
    title: "Arrived",
    body: "Sam arrived",
  }, deps);
  assert.equal(result.email, true);
  assert.equal(email.length, 1);
});

test("a turned-off email does not send even when push delivered zero", async () => {
  const { deps, email } = harness(context({
    operatorIosTokens: 0,
    channels: { "master.email": false },
  }), { push: false });
  const result = await notifyOwner(org, "job.completed", {
    title: "Done",
    body: "Job completed",
  }, deps);
  assert.equal(result.email, false);
  assert.deepEqual(email, []);
});

test("OpenPhone sends the raw key and retries with Bearer after a 401", async () => {
  const auths: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const authorization = new Headers(init?.headers).get("Authorization") ?? "";
    auths.push(authorization);
    const status = authorization.startsWith("Bearer ") ? 200 : 401;
    return new Response(status === 401 ? "unauthorized" : "{}", { status });
  };
  const loaded = harness(context({
    matrix: { "booking.new": { sms: true } },
    notificationPhone: "+15551110001",
    operatorIosTokens: 1,
  }), { push: true });
  delete loaded.deps.sendSms;
  const result = await notifyOwner(org, "booking.new", {
    title: "New booking",
    body: "Alex booked a clean",
  }, loaded.deps);
  assert.equal(result.sms, true);
  assert.deepEqual(auths, ["op-key", "Bearer op-key"]);
});

test("OpenPhone does not retry when the raw key is accepted", async () => {
  const auths: string[] = [];
  globalThis.fetch = async (_input, init) => {
    auths.push(new Headers(init?.headers).get("Authorization") ?? "");
    return new Response("{}", { status: 200 });
  };
  const loaded = harness(context({
    matrix: { "booking.new": { sms: true } },
    notificationPhone: "+15551110001",
    operatorIosTokens: 1,
  }), { push: true });
  delete loaded.deps.sendSms;
  const result = await notifyOwner(org, "booking.new", {
    title: "New booking",
    body: "Alex booked a clean",
  }, loaded.deps);
  assert.equal(result.sms, true);
  assert.deepEqual(auths, ["op-key"]);
});

test("a turned-off group does not ring, push, text, or email", async () => {
  const { deps, sms, email, officeCalls } = harness(context({
    matrix: {
      "job.arrived": { bell: false, native_push: false, email: false, sms: false },
    },
    operatorIosTokens: 0,
  }), { push: true });
  const result = await notifyOwner({ ...org, staffId: "staff-9" }, "job.arrived", {
    title: "Arrived",
    body: "Sam arrived",
  }, deps);
  assert.equal(result.bell, false);
  assert.equal(result.push, false);
  assert.equal(result.sms, false);
  assert.equal(result.email, false);
  assert.equal(officeCalls[0]?.sendPush, false);
  assert.equal(officeCalls[0]?.writeBell, false);
  assert.deepEqual(sms, []);
  assert.deepEqual(email, []);
});

test("a snoozed event sends nothing", async () => {
  const until = new Date(Date.now() + 60_000).toISOString();
  const { deps, sms, email, officeCalls } = harness(context({
    matrix: { "booking.new": { sms: true } },
    snoozedUntil: { "booking.new": until },
    operatorIosTokens: 0,
  }), { push: false });
  const result = await notifyOwner(org, "booking.new", {
    title: "New booking",
    body: "Alex booked a clean",
  }, deps);
  assert.equal(result.sms, false);
  assert.equal(result.email, false);
  assert.equal(result.push, false);
  assert.equal(result.bell, false);
  assert.equal(officeCalls.length, 0);
  assert.deepEqual(sms, []);
  assert.deepEqual(email, []);
});

test("an SMS failure still sends the email fallback", async () => {
  const { deps, email } = harness(context({
    matrix: { "booking.new": { sms: true } },
    operatorIosTokens: 0,
  }), { push: false });
  deps.sendSms = async () => {
    throw new Error("openphone down");
  };
  const result = await notifyOwner(org, "booking.new", {
    title: "New booking",
    body: "Alex booked a clean",
  }, deps);
  assert.equal(result.sms, false);
  assert.equal(result.email, true);
  assert.equal(email.length, 1);
});

test("a push failure still texts and emails", async () => {
  const loaded = harness(context({
    matrix: { "booking.new": { sms: true } },
    operatorIosTokens: 2,
  }), { push: true });
  loaded.deps.notifyOffice = async () => {
    throw new Error("push down");
  };
  const result = await notifyOwner(org, "booking.new", {
    title: "New booking",
    body: "Alex booked a clean",
  }, loaded.deps);
  assert.equal(result.push, false);
  assert.equal(result.sms, true);
  assert.equal(result.email, true);
  assert.equal(loaded.sms.length, 1);
  assert.equal(loaded.email.length, 1);
});

test("a duplicate event for the same booking does not text or email again", async () => {
  const { deps, sms, email, officeCalls } = harness(context({
    matrix: { "booking.new": { sms: true } },
    operatorIosTokens: 0,
  }), { duplicate: true, push: false });
  const result = await notifyOwner(org, "booking.new", {
    title: "New booking",
    body: "Again",
  }, deps);
  assert.equal(result.deduped, true);
  assert.equal(result.sms, false);
  assert.equal(result.email, false);
  assert.equal(officeCalls.length, 1);
  assert.deepEqual(sms, []);
  assert.deepEqual(email, []);
});
