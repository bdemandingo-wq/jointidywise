// Canonical milestone keys and the checklist's live-vs-recorded state.
//
//   node --experimental-strip-types --test src/lib/activationMilestones.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVATION_MILESTONE_KEYS,
  ACTIVATION_MILESTONES,
  checklistMilestones,
  isImportedCreatedVia,
  openPhoneLiveConnected,
  setupStepState,
  stripeLiveConnected,
} from "./activationMilestones.ts";

const migration = readFileSync(
  new URL("../../supabase/migrations/20261014230000_activation_tracking_and_signup_utm.sql", import.meta.url),
  "utf8",
);

test("milestone keys and display labels are the canonical list", () => {
  assert.deepEqual([...ACTIVATION_MILESTONE_KEYS], [
    "trial_signup",
    "service_added",
    "staff_added",
    "openphone_connected",
    "stripe_connected",
    "first_job_booked",
    "clients_imported",
    "first_payment_received",
  ]);
  assert.deepEqual(
    ACTIVATION_MILESTONES.map((milestone) => [milestone.key, milestone.label]),
    [
      ["trial_signup", "Trial signup"],
      ["service_added", "Add your first service"],
      ["staff_added", "Add your first staff member"],
      ["openphone_connected", "Connect OpenPhone"],
      ["stripe_connected", "Connect Stripe"],
      ["first_job_booked", "Create your first booking"],
      ["clients_imported", "Clients imported"],
      ["first_payment_received", "First client payment received"],
    ],
  );
  assert.match(
    ACTIVATION_MILESTONES.find((milestone) => milestone.key === "first_payment_received")?.description ?? "",
    /not TidyWise subscription revenue/,
  );
});

test("the migration check constraint lists the same keys and not cleaner_added", () => {
  const check = migration.match(
    /ADD CONSTRAINT organization_activation_events_milestone_check\s+CHECK \(milestone IN \(([\s\S]*?)\)\)/,
  );
  assert.ok(check, "milestone check constraint missing");
  for (const key of ACTIVATION_MILESTONE_KEYS) {
    assert.match(check[1], new RegExp(`'${key}'`));
  }
  assert.equal(check[1].includes("cleaner_added"), false);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS organization_activation_events_milestone_check/);
  assert.doesNotMatch(migration, /CREATE TRIGGER on_auth_user_last_login ON auth\.users/);
  assert.match(migration, /touch_my_last_login/);
  assert.match(migration, /first_payment_received is a client paying this cleaning business/);
});

test("checklist steps are the five setup items, in checklist order", () => {
  assert.deepEqual(
    checklistMilestones().map((milestone) => milestone.key),
    ["service_added", "staff_added", "openphone_connected", "stripe_connected", "first_job_booked"],
  );
  const stripe = checklistMilestones().find((milestone) => milestone.key === "stripe_connected");
  assert.equal(stripe?.attention, "Needs attention, reconnect Stripe");
});

test("step state is live status first, then the milestone", () => {
  assert.equal(setupStepState(true, false), "done");
  assert.equal(setupStepState(true, true), "done");
  assert.equal(setupStepState(false, true), "needs_attention");
  assert.equal(setupStepState(false, false), "never_done");
});

test("imported sources are not native writes", () => {
  assert.equal(isImportedCreatedVia("migration_import"), true);
  assert.equal(isImportedCreatedVia(" csv_import "), true);
  assert.equal(isImportedCreatedVia("CSV_IMPORT"), true);
  assert.equal(isImportedCreatedVia(null), false);
  assert.equal(isImportedCreatedVia(""), false);
  assert.equal(isImportedCreatedVia("booking_form"), false);
});

test("OpenPhone is live only with an API key and a phone number", () => {
  assert.equal(openPhoneLiveConnected(true, "PN123"), true);
  assert.equal(openPhoneLiveConnected(true, "  "), false);
  assert.equal(openPhoneLiveConnected(false, "PN123"), false);
  assert.equal(openPhoneLiveConnected(true, null), false);
});

test("Stripe is live from is_connected or a Connect account id", () => {
  assert.equal(stripeLiveConnected({ is_connected: true, stripe_account_id: null }), true);
  assert.equal(stripeLiveConnected({ is_connected: false, stripe_account_id: "acct_123" }), true);
  assert.equal(stripeLiveConnected({ is_connected: false, stripe_account_id: "  " }), false);
  assert.equal(stripeLiveConnected(null), false);
});

test("the migration importer tags bookings and staff, and predicates ignore imports", () => {
  const importer = readFileSync(
    new URL("../../supabase/functions/process-migration-import/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(importer, /created_via: "migration_import"/);
  assert.match(importer, /insertImported\(\s*"bookings"/);
  assert.match(importer, /insertImported\(\s*"staff"/);
  assert.match(migration, /row_is_imported/);
  assert.match(migration, /AND NOT public\.row_is_imported\(p_row\)/);
});
