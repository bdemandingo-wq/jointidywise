import { isValidEmail } from "../_shared/email-address.ts";

// copilot-csv-import — bulk customer import from a CSV.
//
// Accepts either:
//   - { organization_id, csv_text, column_mappings? }   (recommended)
//   - { organization_id, rows, column_mappings? }       (rows already parsed)
//
// If column_mappings isn't supplied, Claude infers a mapping from the CSV
// headers + first 3 sample rows. Frontend can call once with no mappings to
// get a suggested mapping, show it to the user for review, then call again
// with the user-confirmed mappings to actually import.
//
// xlsx parsing is intentionally NOT implemented here — the frontend should
// convert xlsx to csv client-side (we already ship the xlsx package).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { parse as parseCsv } from "https://deno.land/std@0.224.0/csv/parse.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.40.0";
import { requireOrgAdmin, sharedCorsHeaders } from "../_shared/requireOrgAdmin.ts";

const MODEL = "claude-opus-4-7";

// Customer fields the importer can fill. Keep this in sync with the
// public.customers schema. Anything outside this list is "skipped" (not
// dropped — preserved as a note if asked).
const CUSTOMER_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zip_code",
  "notes",
] as const;
type CustomerField = (typeof CUSTOMER_FIELDS)[number];

type ColumnMapping = Partial<Record<CustomerField, string | null>>;

interface ImportRequest {
  organization_id?: string;
  csv_text?: string;
  rows?: Array<Record<string, string>>;
  column_mappings?: ColumnMapping;
  preview_only?: boolean;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: sharedCorsHeaders });
  }

  let body: ImportRequest = {};
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const organizationId = body.organization_id;
  if (!organizationId) return jsonError(400, "organization_id required");

  // Admin-only — bulk inserting customers is a privileged action.
  const auth = await requireOrgAdmin(req, organizationId);
  if (auth instanceof Response) return auth;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError(500, "Supabase configuration missing");
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // --- 1. Parse the CSV / rows --------------------------------------------
  let rows: Array<Record<string, string>>;
  if (body.rows && Array.isArray(body.rows) && body.rows.length > 0) {
    rows = body.rows;
  } else if (body.csv_text) {
    try {
      const parsed = parseCsv(body.csv_text, { skipFirstRow: true });
      rows = parsed as Array<Record<string, string>>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonError(400, `CSV parse failed: ${msg}`);
    }
  } else {
    return jsonError(400, "Provide either csv_text or rows");
  }

  if (rows.length === 0) return jsonError(400, "CSV contained no rows");
  if (rows.length > 5000) {
    return jsonError(413, "CSV too large — split into chunks of 5000 rows or fewer");
  }

  const headers = Object.keys(rows[0]);
  if (headers.length === 0) return jsonError(400, "CSV has no columns");

  // --- 2. Resolve column mappings (user-supplied or inferred) -------------
  let mappings: ColumnMapping = body.column_mappings ?? {};
  let mappingSource: "user" | "inferred" = "user";
  if (!body.column_mappings) {
    mappingSource = "inferred";
    try {
      mappings = await inferMappings(headers, rows.slice(0, 3));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[copilot-csv-import] Mapping inference failed:", msg);
      return jsonError(502, `Could not infer column mappings: ${msg}`);
    }
  }
  validateMappings(mappings, headers);

  // --- 3. Map rows to customer candidates ---------------------------------
  const candidates = rows.map((r) => applyMapping(r, mappings));

  // --- 4. Detect duplicates against existing customers in this org --------
  const incomingPhones = uniq(candidates.map((c) => c.phone).filter(isNonEmpty));
  const incomingEmails = uniq(
    candidates.map((c) => c.email?.toLowerCase()).filter(isNonEmpty),
  );

  const existingPhones = new Set<string>();
  const existingEmails = new Set<string>();
  if (incomingPhones.length > 0 || incomingEmails.length > 0) {
    const filters: string[] = [];
    if (incomingPhones.length > 0) {
      filters.push(`phone.in.(${incomingPhones.map(quoteCsvValue).join(",")})`);
    }
    if (incomingEmails.length > 0) {
      filters.push(`email.in.(${incomingEmails.map(quoteCsvValue).join(",")})`);
    }
    const { data: existing } = await supabase
      .from("customers")
      .select("phone, email")
      .eq("organization_id", organizationId)
      .or(filters.join(","));
    for (const e of (existing ?? []) as Array<{ phone?: string; email?: string }>) {
      if (e.phone) existingPhones.add(e.phone);
      if (e.email) existingEmails.add(e.email.toLowerCase());
    }
  }

  // Also dedupe within the incoming batch itself.
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  const toInsert: Array<Record<string, unknown>> = [];
  const skippedDuplicates: Array<Record<string, unknown>> = [];
  // Rows that DO import but lost an unusable email. Kept separate from
  // flaggedIncomplete, whose rows are not imported at all — reporting a
  // successful import as "incomplete" would be its own quiet lie.
  const droppedEmails: Array<Record<string, unknown>> = [];
  const flaggedIncomplete: Array<Record<string, unknown>> = [];

  for (const c of candidates) {
    const firstName = (c.first_name ?? "").trim();
    const lastName = (c.last_name ?? "").trim();
    const phone = (c.phone ?? "").trim() || null;
    const emailRaw = (c.email ?? "").trim();
    // Validated, not merely lowercased. This path had no format check, so a
    // merged email+phone column imported verbatim and every send to that
    // customer failed silently. Unusable becomes NULL: the customer is
    // still worth creating from their name and phone.
    const emailInvalid = emailRaw.length > 0 && !isValidEmail(emailRaw);
    const email = emailInvalid ? null : (emailRaw ? emailRaw.toLowerCase() : null);
    if (emailInvalid) droppedEmails.push({ ...c, reason: "invalid_email" });

    if (!firstName && !lastName) {
      flaggedIncomplete.push({ ...c, reason: "missing_name" });
      continue;
    }
    if (!phone && !email) {
      flaggedIncomplete.push({ ...c, reason: "no_contact" });
      continue;
    }

    const dupExisting = (phone && existingPhones.has(phone)) ||
      (email && existingEmails.has(email));
    const dupIncoming = (phone && seenPhones.has(phone)) ||
      (email && seenEmails.has(email));
    if (dupExisting || dupIncoming) {
      skippedDuplicates.push({ ...c, reason: dupExisting ? "exists" : "duplicate_in_csv" });
      continue;
    }

    if (phone) seenPhones.add(phone);
    if (email) seenEmails.add(email);

    toInsert.push({
      organization_id: organizationId,
      first_name: firstName || "(no first name)",
      last_name: lastName || "(no last name)",
      email: email ?? "",
      phone,
      address: (c.address ?? null) || null,
      city: (c.city ?? null) || null,
      state: (c.state ?? null) || null,
      zip_code: (c.zip_code ?? null) || null,
      notes: (c.notes ?? null) || null,
    });
  }

  // --- 5. Insert (unless preview-only) ------------------------------------
  let importedCount = 0;
  let insertError: string | null = null;
  if (!body.preview_only && toInsert.length > 0) {
    const { error, count } = await supabase
      .from("customers")
      .insert(toInsert, { count: "exact" });
    if (error) {
      insertError = error.message;
      console.error("[copilot-csv-import] Insert failed:", error.message);
    } else {
      importedCount = count ?? toInsert.length;
    }
  }

  // --- 6. Update onboarding_progress counters -----------------------------
  if (!body.preview_only) {
    await bumpImportCounters(supabase, organizationId, !!insertError);
    if (importedCount > 0) {
      await markMilestoneThree(supabase, organizationId);
    }
  }

  return jsonOk({
    preview_only: !!body.preview_only,
    imported: importedCount,
    would_insert: toInsert.length,
    skipped_duplicates: skippedDuplicates.length,
    flagged_incomplete: flaggedIncomplete.length,
    dropped_emails: droppedEmails.length,
    mappings,
    mapping_source: mappingSource,
    flagged_samples: flaggedIncomplete.slice(0, 5),
    dropped_email_samples: droppedEmails.slice(0, 5),
    skipped_samples: skippedDuplicates.slice(0, 5),
    insert_error: insertError,
  });
});

// ---------------------------------------------------------------------------
// Mapping inference via Claude
// ---------------------------------------------------------------------------

async function inferMappings(
  headers: string[],
  samples: Array<Record<string, string>>,
): Promise<ColumnMapping> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  // We use a single tool to get a structured mapping back. tool_choice forces
  // the model to use it on first response.
  const tool: Anthropic.Tool = {
    name: "set_column_mapping",
    description:
      "Map each TidyWise customer field to one of the CSV columns, or null if the CSV doesn't have that field. Only emit a mapping when you're confident.",
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        CUSTOMER_FIELDS.map((f) => [
          f,
          {
            type: ["string", "null"],
            description:
              `The CSV column name that best matches the customer's ${f}, or null if none.`,
          },
        ]),
      ) as Record<string, unknown>,
      required: [...CUSTOMER_FIELDS] as string[],
      additionalProperties: false,
    },
  };

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: "low" },
    tools: [tool],
    tool_choice: { type: "tool", name: "set_column_mapping" },
    system:
      "You're mapping a cleaning-business CSV to TidyWise's customer schema. Be conservative — if unsure, return null for that field rather than guessing. Phone columns might be 'Phone', 'Mobile', 'Cell', etc. Address might be a single 'Address' column or split into street/city/state/zip.",
    messages: [
      {
        role: "user",
        content:
          `CSV columns: ${JSON.stringify(headers)}\n\n` +
          `First ${samples.length} sample rows:\n${JSON.stringify(samples, null, 2)}`,
      },
    ],
  } as Anthropic.MessageCreateParams) as unknown as Anthropic.Message;

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("Claude did not return a mapping");
  const input = toolUse.input as ColumnMapping;
  return input;
}

function validateMappings(mappings: ColumnMapping, headers: string[]): void {
  for (const [field, column] of Object.entries(mappings)) {
    if (!column) continue;
    if (!headers.includes(column)) {
      throw new Error(
        `Mapping for ${field} references unknown column "${column}". Valid columns: ${
          headers.join(", ")
        }`,
      );
    }
  }
}

function applyMapping(
  row: Record<string, string>,
  mappings: ColumnMapping,
): Partial<Record<CustomerField, string>> {
  const out: Partial<Record<CustomerField, string>> = {};
  for (const field of CUSTOMER_FIELDS) {
    const col = mappings[field];
    if (col && row[col] != null) {
      const v = String(row[col]).trim();
      if (v) out[field] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// onboarding_progress helpers
// ---------------------------------------------------------------------------

async function bumpImportCounters(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  organizationId: string,
  failed: boolean,
): Promise<void> {
  const { data: existing } = await supabase
    .from("onboarding_progress")
    .select("id, csv_imports_attempted, csv_imports_succeeded")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("onboarding_progress")
      .update({
        csv_imports_attempted: (existing.csv_imports_attempted ?? 0) + 1,
        csv_imports_succeeded: (existing.csv_imports_succeeded ?? 0) +
          (failed ? 0 : 1),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("onboarding_progress").insert({
      organization_id: organizationId,
      csv_imports_attempted: 1,
      csv_imports_succeeded: failed ? 0 : 1,
    });
  }
}

async function markMilestoneThree(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  organizationId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("onboarding_progress")
    .select("id, milestone_3_clients_added_completed_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (existing) {
    if (!existing.milestone_3_clients_added_completed_at) {
      await supabase
        .from("onboarding_progress")
        .update({ milestone_3_clients_added_completed_at: now })
        .eq("id", existing.id);
    }
  } else {
    await supabase.from("onboarding_progress").insert({
      organization_id: organizationId,
      milestone_3_clients_added_completed_at: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function quoteCsvValue(v: string): string {
  // PostgREST `.in.(...)` filter values — escape commas/parens by quoting.
  return `"${v.replace(/"/g, '\\"')}"`;
}

function jsonError(status: number, error: string): Response {
  return new Response(
    JSON.stringify({ success: false, error }),
    { status, headers: { ...sharedCorsHeaders, "Content-Type": "application/json" } },
  );
}

function jsonOk(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ success: true, ...payload }),
    { status: 200, headers: { ...sharedCorsHeaders, "Content-Type": "application/json" } },
  );
}
