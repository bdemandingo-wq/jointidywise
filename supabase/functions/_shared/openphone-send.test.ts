import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPENPHONE_MESSAGES_URL,
  clearSmsSuppression,
  recordSmsSuppression,
  sendOpenPhoneMessage,
  type SmsQuery,
  type SmsTable,
} from "./openphone-send.ts";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const E164 = "+18135550100";

interface Row {
  id: string;
  phone: string;
  opted_out_method?: string;
  organization_id: string;
}

function mockDb(opts: {
  suppressions?: Row[];
  customers?: Row[];
  suppressionError?: string;
  customersError?: string;
  writes?: Array<{ op: string; table: string; row?: unknown; phone?: string; org?: string }>;
}) {
  const writes = opts.writes ?? [];
  const fetches: Array<{ url: string; body: { to: string[]; content: string; from: string }; authorization: string }> = [];
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    fetches.push({
      url,
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
    from(table: string): SmsTable {
      const filters: Record<string, string> = {};
      const api = {
        select() { return api; },
        eq(column: string, value: string) {
          filters[column] = value;
          return api;
        },
        order() { return api; },
        range() { return api; },
        delete() { return api; },
        upsert(row: Record<string, unknown>) {
          writes.push({ op: "upsert", table, row });
          return Promise.resolve({ error: null });
        },
        maybeSingle() {
          if (opts.suppressionError && table === "sms_suppressions") {
            return Promise.resolve({ data: null, error: { message: opts.suppressionError } });
          }
          const hit = (opts.suppressions ?? []).find((row) =>
            row.organization_id === filters.organization_id && row.phone === filters.phone
          );
          return Promise.resolve({ data: hit ? { id: hit.id } : null, error: null });
        },
        then<T>(onfulfilled: (value: { data: unknown; error: { message?: string } | null }) => T) {
          if (filters.phone && table === "sms_suppressions" && !("select-used" in filters)) {
            writes.push({
              op: "delete",
              table,
              phone: filters.phone,
              org: filters.organization_id,
            });
            return Promise.resolve({ data: null, error: null }).then(onfulfilled);
          }
          if (table === "customers") {
            if (opts.customersError) {
              return Promise.resolve({ data: null, error: { message: opts.customersError } }).then(onfulfilled);
            }
            const rows = (opts.customers ?? []).filter((row) =>
              row.organization_id === filters.organization_id
              && row.opted_out_method === filters.opted_out_method
            );
            return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
          }
          return Promise.resolve({ data: null, error: null }).then(onfulfilled);
        },
      };
      return api as SmsQuery & SmsTable;
    },
  };

  return { supabase, fetchImpl, fetches, writes };
}

const base = {
  organizationId: ORG,
  to: "(813) 555-0100",
  content: "On the way",
  from: "PNtest",
  apiKey: "Bearer secret-key",
  tag: "unit",
};

test("a suppressed number is not sent", async () => {
  const db = mockDb({
    suppressions: [{ id: "s1", phone: E164, organization_id: ORG }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("the same number in another org is still sent", async () => {
  const db = mockDb({
    suppressions: [{ id: "s1", phone: E164, organization_id: OTHER_ORG }],
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
  assert.equal(db.fetches[0].url, OPENPHONE_MESSAGES_URL);
  assert.deepEqual(db.fetches[0].body.to, [E164]);
  assert.equal(db.fetches[0].authorization, "secret-key");
});

test("a customer sms_stop column blocks a differently formatted number", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: "813-555-0100",
      opted_out_method: "sms_stop",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    to: "+1 813 555 0100",
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("a manual marketing opt-out is not a STOP block", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: "8135550100",
      opted_out_method: "manual",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  assert.equal(db.fetches.length, 1);
});

test("the STOP confirmation is delivered to a suppressed number", async () => {
  const db = mockDb({
    suppressions: [{ id: "s1", phone: E164, organization_id: ORG }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    content: "You're unsubscribed.",
    allowOptedOut: true,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  assert.equal(db.fetches.length, 1);
  assert.equal(db.fetches[0].body.content, "You're unsubscribed.");
});

test("a lookup error does not send and does not throw", async () => {
  const db = mockDb({ suppressionError: "connection reset" });
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

test("STOP records an E.164 suppression and START clears it", async () => {
  const writes: Array<{ op: string; table: string; row?: unknown; phone?: string }> = [];
  const db = mockDb({ writes });
  const recorded = await recordSmsSuppression(db.supabase, ORG, "813.555.0100");
  assert.equal(recorded, true);
  assert.equal(writes[0].op, "upsert");
  assert.deepEqual(
    (writes[0].row as { phone: string; organization_id: string; source: string }),
    { phone: E164, organization_id: ORG, source: "sms_stop" },
  );

  const cleared = await clearSmsSuppression(db.supabase, ORG, "+1 (813) 555-0100");
  assert.equal(cleared, true);
  assert.equal(writes[1].op, "delete");
  assert.equal(writes[1].phone, E164);
});
