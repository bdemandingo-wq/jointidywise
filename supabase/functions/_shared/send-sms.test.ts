import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearSmsSuppression,
  recordSmsSuppression,
  sendOpenPhoneMessage,
  type SmsSendPurpose,
} from "./send-sms.ts";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const E164 = "+18135550100";
const MESSAGES_PATH = ["v1", "messages"].join("/");
const STOP_CONFIRMATION: SmsSendPurpose = "stop_confirmation";
const HELP_REPLY: SmsSendPurpose = "help";

interface Row {
  id: string;
  phone: string;
  marketing_status: string | null;
  organization_id: string;
  opted_out_method?: string | null;
}

interface Suppression {
  organization_id: string;
  phone: string;
  source: string;
}

function mockDb(opts: {
  customers?: Row[];
  customersError?: string;
  suppressions?: Suppression[];
  suppressionsError?: string;
  logsThrow?: boolean;
}) {
  const fetches: Array<{
    url: string;
    method: string;
    body: { to: string[]; content: string; from: string };
    authorization: string;
  }> = [];
  const suppressions = [...(opts.suppressions ?? [])];
  const logs: Array<Record<string, unknown>> = [];
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    fetches.push({
      url,
      method: init.method,
      body: JSON.parse(init.body) as { to: string[]; content: string; from: string },
      authorization: init.headers.Authorization,
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { id: "msg_test" } }),
    };
  };

  const supabase = {
    from(table: string) {
      const filters: Record<string, string> = {};
      let phoneIn: string[] | null = null;
      let op: "select" | "delete" = "select";
      const api = {
        select() {
          op = "select";
          return api;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return api;
        },
        in(column: string, values: string[]) {
          if (column === "phone") phoneIn = values;
          return api;
        },
        not() { return api; },
        order() { return api; },
        limit() { return api; },
        range() { return api; },
        delete() {
          op = "delete";
          return api;
        },
        insert(values: Record<string, unknown>) {
          if (table === "system_logs") {
            if (opts.logsThrow) throw new Error("logs down");
            logs.push(values);
          }
          if (table === "sms_suppressions") {
            const row = values as unknown as Suppression;
            const idx = suppressions.findIndex((entry) =>
              entry.organization_id === row.organization_id && entry.phone === row.phone
            );
            if (idx >= 0) {
              return Promise.resolve({ error: { message: "duplicate suppression" } });
            }
            suppressions.push(row);
          }
          return Promise.resolve({ error: null });
        },
        upsert(values: Record<string, unknown>) {
          if (table === "sms_suppressions") {
            const row = values as unknown as Suppression;
            const idx = suppressions.findIndex((entry) =>
              entry.organization_id === row.organization_id && entry.phone === row.phone
            );
            if (idx >= 0) suppressions[idx] = row;
            else suppressions.push(row);
          }
          return Promise.resolve({ error: null });
        },
        maybeSingle() {
          if (table === "sms_suppressions") {
            if (opts.suppressionsError) {
              return Promise.resolve({ data: null, error: { message: opts.suppressionsError } });
            }
            const hit = suppressions.find((entry) =>
              entry.organization_id === filters.organization_id && entry.phone === filters.phone
            );
            return Promise.resolve({ data: hit ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then<T>(onfulfilled: (value: { data: unknown; error: { message?: string } | null }) => T) {
          if (table === "sms_suppressions" && op === "delete") {
            for (let i = suppressions.length - 1; i >= 0; i--) {
              const row = suppressions[i];
              const sourceOk = filters.source === undefined || row.source === filters.source;
              if (row.organization_id === filters.organization_id && row.phone === filters.phone && sourceOk) {
                suppressions.splice(i, 1);
              }
            }
            return Promise.resolve({ data: null, error: null }).then(onfulfilled);
          }
          if (table === "customers") {
            if (opts.customersError) {
              return Promise.resolve({ data: null, error: { message: opts.customersError } }).then(onfulfilled);
            }
            const rows = (opts.customers ?? []).filter((row) => {
              if (row.organization_id !== filters.organization_id) return false;
              if (phoneIn && !phoneIn.includes(row.phone)) return false;
              return true;
            });
            return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
          }
          return Promise.resolve({ data: null, error: null }).then(onfulfilled);
        },
      };
      return api;
    },
  };

  return { supabase, fetchImpl, fetches, suppressions, logs };
}

const base = {
  organizationId: ORG,
  to: "(813) 555-0100",
  content: "On the way",
  from: "PNtest",
  apiKey: "Bearer secret-key",
  tag: "unit",
};

test("an SMS STOP on the customer row is not sent", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: "(813) 555-0100",
      marketing_status: "opted_out",
      opted_out_method: "sms_stop",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
  assert.equal(db.logs.length, 1);
  assert.equal(db.logs[0].source, "send-sms");
  assert.equal(db.logs[0].organization_id, ORG);
  assert.equal(db.logs[0].message, "SMS skipped: number opted out");
  assert.deepEqual(db.logs[0].details, { to: E164, tag: "unit", reason: "opted_out" });
});

test("the same number in another org is still sent", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: E164,
      marketing_status: "opted_out",
      organization_id: OTHER_ORG,
    }],
    suppressions: [{ organization_id: OTHER_ORG, phone: E164, source: "sms_stop" }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  if (result.skipped) return;
  assert.equal(result.response.ok, true);
  assert.equal(db.fetches.length, 1);
  assert.equal(db.fetches[0].method, "POST");
  assert.ok(db.fetches[0].url.endsWith(MESSAGES_PATH));
  assert.deepEqual(db.fetches[0].body.to, [E164]);
  assert.equal(db.fetches[0].authorization, "secret-key");
  assert.equal(db.logs.length, 0);
});

test("a last-10 match blocks an SMS STOP stored in another format", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: "please call 813.555.0100 today",
      marketing_status: "opted_out",
      opted_out_method: "sms_stop",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    to: "+1 (813) 555-0100",
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("a differently formatted SMS STOP blocks a transactional text", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: "813-555-0100",
      marketing_status: "opted_out",
      opted_out_method: "sms_stop",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    to: "+1 813 555 0100",
    content: "Your cleaner is on the way",
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("one SMS STOP blocks the number even when another record is still opted in", async () => {
  const db = mockDb({
    customers: [
      {
        id: "c1",
        phone: "8135550100",
        marketing_status: "subscribed",
        organization_id: ORG,
      },
      {
        id: "c2",
        phone: "+18135550100",
        marketing_status: "opted_out",
        opted_out_method: "sms_stop",
        organization_id: ORG,
      },
    ],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("an email unsubscribe or an admin bulk opt-out does not block texts", async () => {
  for (const method of ["email", "manual"]) {
    const db = mockDb({
      customers: [{
        id: "c1",
        phone: "(813) 555-0100",
        marketing_status: "opted_out",
        opted_out_method: method,
        organization_id: ORG,
      }],
    });
    const result = await sendOpenPhoneMessage({
      ...base,
      supabase: db.supabase,
      fetchImpl: db.fetchImpl,
    });
    assert.equal(result.skipped, false, method);
    assert.equal(db.fetches.length, 1, method);
  }
});

test("a lead or cleaner suppression blocks a number with no customer row", async () => {
  const db = mockDb({
    customers: [],
    suppressions: [{ organization_id: ORG, phone: E164, source: "sms_stop" }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    content: "New lead assigned",
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
  assert.equal(db.logs.length, 1);
});

test("recording STOP for a non-customer number blocks the next text", async () => {
  const db = mockDb({ customers: [] });
  const recorded = await recordSmsSuppression(db.supabase, ORG, "813-555-0100");
  assert.equal(recorded, true);
  assert.equal(db.suppressions.length, 1);
  assert.equal(db.suppressions[0].phone, E164);
  assert.equal(db.suppressions[0].source, "sms_stop");
  await recordSmsSuppression(db.supabase, ORG, E164);
  assert.equal(db.suppressions.length, 1);

  const result = await sendOpenPhoneMessage({
    ...base,
    content: "You're assigned to a job tomorrow",
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("STOP does not overwrite a non-STOP suppression and START does not delete it", async () => {
  const db = mockDb({
    customers: [],
    suppressions: [{ organization_id: ORG, phone: E164, source: "carrier_block" }],
  });
  const recorded = await recordSmsSuppression(db.supabase, ORG, "(813) 555-0100");
  assert.equal(recorded, true);
  assert.equal(db.suppressions.length, 1);
  assert.equal(db.suppressions[0].source, "carrier_block");

  const cleared = await clearSmsSuppression(db.supabase, ORG, E164);
  assert.equal(cleared, true);
  assert.equal(db.suppressions.length, 1);
  assert.equal(db.suppressions[0].source, "carrier_block");

  const stillBlocked = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(stillBlocked, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("START clears the suppression and a non-blocking status allows the next text", async () => {
  const customers: Row[] = [{
    id: "c1",
    phone: E164,
    marketing_status: "opted_out",
    opted_out_method: "sms_stop",
    organization_id: ORG,
  }];
  const db = mockDb({
    customers,
    suppressions: [{ organization_id: ORG, phone: E164, source: "sms_stop" }],
  });
  const blocked = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(blocked.skipped, true);

  const cleared = await clearSmsSuppression(db.supabase, ORG, "(813) 555-0100");
  assert.equal(cleared, true);
  assert.equal(db.suppressions.length, 0);

  const stillBlocked = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(stillBlocked.skipped, true);
  assert.equal(db.fetches.length, 0);

  customers[0].marketing_status = "subscribed";
  const sent = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(sent.skipped, false);
  assert.equal(db.fetches.length, 1);
});

test("the STOP confirmation and HELP reply are delivered to a suppressed number", async () => {
  for (const purpose of [STOP_CONFIRMATION, HELP_REPLY]) {
    const db = mockDb({
      customers: [],
      suppressions: [{ organization_id: ORG, phone: E164, source: "sms_stop" }],
    });
    const result = await sendOpenPhoneMessage({
      ...base,
      content: purpose === HELP_REPLY ? "Call us." : "You're unsubscribed.",
      purpose,
      supabase: db.supabase,
      fetchImpl: db.fetchImpl,
    });
    assert.equal(result.skipped, false, purpose);
    assert.equal(db.fetches.length, 1, purpose);
    assert.equal(db.fetches[0].method, "POST");
    assert.equal(db.logs.length, 0, purpose);
  }
});

test("an unknown purpose does not bypass the opt-out", async () => {
  const db = mockDb({
    customers: [],
    suppressions: [{ organization_id: ORG, phone: E164, source: "sms_stop" }],
  });
  const notACompliancePurpose = "marketing";
  const result = await sendOpenPhoneMessage({
    ...base,
    purpose: notACompliancePurpose as SmsSendPurpose,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("a failed skip log still returns opted out and does not send", async () => {
  const db = mockDb({
    customers: [],
    suppressions: [{ organization_id: ORG, phone: E164, source: "sms_stop" }],
    logsThrow: true,
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("a lookup error does not send and does not throw", async () => {
  const db = mockDb({ customersError: "connection reset" });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  if (result.skipped) return;
  assert.equal(result.response.ok, false);
  assert.equal(await result.response.text(), "opt-out lookup failed");
  assert.equal(db.fetches.length, 0);
  assert.equal(db.logs.length, 0);
});

test("an unusable phone is not sent", async () => {
  const db = mockDb({});
  const result = await sendOpenPhoneMessage({
    ...base,
    to: "123",
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  if (result.skipped) return;
  assert.equal(result.response.ok, false);
  assert.equal(db.fetches.length, 0);
});

test("a number with no customer row and no suppression is still sent", async () => {
  const db = mockDb({ customers: [] });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  assert.equal(db.fetches.length, 1);
});
