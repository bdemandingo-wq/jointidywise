import { isValidEmail } from "../_shared/email-address.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizeMoney(v: any): number {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function normalizeInt(v: any, fallback = 0): number {
  if (v == null) return fallback;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : fallback;
}
function normalizeFrequency(v: any): string {
  const s = String(v || "").toLowerCase().trim();
  if (!s) return "weekly";
  if (s.includes("week") && !s.includes("bi") && !s.includes("every other")) return "weekly";
  if (s.includes("bi") || s.includes("every other") || s.includes("two week") || s.includes("2 week")) return "biweekly";
  if (s.includes("tri") || s.includes("3 week") || s.includes("three week")) return "triweekly";
  if (s.includes("month")) return "monthly";
  if (s.includes("one") || s.includes("once") || s === "no") return "one_time";
  return s;
}
function normalizeStatus(v: any): string {
  const s = String(v || "").toLowerCase().trim();
  if (!s) return "confirmed";
  if (s.includes("complete") || s.includes("done") || s.includes("finished")) return "completed";
  if (s.includes("cancel")) return "cancelled";
  if (s.includes("pend") || s.includes("await")) return "pending";
  if (s.includes("no show") || s.includes("noshow")) return "cancelled";
  if (s.includes("confirm") || s.includes("scheduled") || s.includes("active")) return "confirmed";
  return "confirmed";
}
function normalizePaymentStatus(v: any): string {
  const s = String(v || "").toLowerCase().trim();
  if (!s) return "pending";
  if (s === "true" || s === "yes" || s.includes("paid") || s.includes("complete")) return "paid";
  if (s.includes("refund")) return "refunded";
  if (s.includes("fail") || s.includes("decline")) return "failed";
  return "pending";
}
function dayOfWeekFromString(v: any): number | null {
  const s = String(v || "").toLowerCase().trim();
  const map: Record<string, number> = {
    sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5, saturday: 6, sat: 6,
  };
  if (map[s] !== undefined) return map[s];
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 0 && n <= 6) return n;
  return null;
}
function parseExtras(v: any): any[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(String(v));
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return String(v).split(/[,;|]/).map(s => s.trim()).filter(Boolean).map(name => ({ name }));
}
function parseTags(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v).split(/[,;|]/).map(s => s.trim()).filter(Boolean);
}

async function findCustomer(
  admin: any, orgId: string,
  data: Record<string, any>,
): Promise<string | null> {
  const email = (data.customer_email || data.email || "").trim().toLowerCase();
  const phoneDigits = String(data.customer_phone || data.phone || "").replace(/\D/g, "");
  const name = String(data.customer_name || data.full_name || "").trim();

  if (email) {
    const { data: row } = await admin.from("customers").select("id")
      .eq("organization_id", orgId).ilike("email", email).maybeSingle();
    if (row?.id) return row.id;
  }
  if (phoneDigits.length >= 7) {
    const { data: rows } = await admin.from("customers").select("id, phone")
      .eq("organization_id", orgId).not("phone", "is", null).limit(500);
    const match = (rows || []).find((r: any) => String(r.phone || "").replace(/\D/g, "").endsWith(phoneDigits.slice(-10)));
    if (match) return match.id;
  }
  if (name) {
    const [first, ...rest] = name.split(/\s+/);
    const last = rest.join(" ");
    const { data: row } = await admin.from("customers").select("id")
      .eq("organization_id", orgId)
      .ilike("first_name", first)
      .ilike("last_name", last ? last : "%")
      .maybeSingle();
    if (row?.id) return row.id;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { importId, organizationId } = await req.json();
    if (!importId || !organizationId) {
      return new Response(JSON.stringify({ error: "Missing importId or organizationId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: membership } = await supabaseClient
      .from("org_memberships").select("role")
      .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: importRecord, error: importErr } = await adminClient
      .from("migration_imports").select("*")
      .eq("id", importId).eq("organization_id", organizationId).single();
    if (importErr || !importRecord) {
      return new Response(JSON.stringify({ error: "Import not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await adminClient.from("migration_imports")
      .update({ status: "importing", started_at: new Date().toISOString() })
      .eq("id", importId);

    const { data: rows, error: rowsErr } = await adminClient
      .from("migration_import_rows").select("*")
      .eq("import_id", importId).in("status", ["valid"]).order("row_number");
    if (rowsErr) throw rowsErr;

    let imported = 0, skipped = 0, errors = 0;
    const errorLog: any[] = [];
    const dataType = importRecord.data_type;

    for (const row of rows || []) {
      try {
        const data = row.mapped_data as Record<string, any>;

        if (dataType === "customers") {
          // Only treat as duplicate when the email is a real email address.
          // Thumbtack/lead CSVs often contain placeholder text (business name,
          // "n/a", blank) in the email column — those should NOT collapse every
          // imported lead into one duplicate.
          const emailRaw = data.email ? String(data.email).trim() : "";
          // Was /^[^\s@]+@[^\s@]+\.[^\s@]+$/, which passed
          // `chefbschrank@gmail.com+15615830771` — a phone number welded onto
          // the TLD — because [^\s@]+ accepts anything without a space or an
          // at-sign. That value was imported and every booking confirmation to
          // that customer failed silently from February.
          const emailIsReal = isValidEmail(emailRaw)
            && !emailRaw.toLowerCase().endsWith("@placeholder.local");
          if (emailIsReal) {
            const { data: existing } = await adminClient.from("customers").select("id")
              .eq("organization_id", organizationId).ilike("email", emailRaw).maybeSingle();
            if (existing) {
              await adminClient.from("migration_import_rows")
                .update({ status: "duplicate", duplicate_of: existing.id }).eq("id", row.id);
              skipped++; continue;
            }
          }

          // Append tags + company to notes (no dedicated columns)
          let notes = data.notes ? String(data.notes).substring(0, 1500) : "";
          if (data.company_name) notes = `[Company: ${String(data.company_name).substring(0, 100)}]\n${notes}`.trim();
          if (data.tags) {
            const tags = parseTags(data.tags);
            if (tags.length) notes = `${notes}\n[Tags: ${tags.join(", ")}]`.trim();
          }
          if (data.lifetime_value) notes = `${notes}\n[Lifetime value: ${data.lifetime_value}]`.trim();

          const status = String(data.customer_status || "").toLowerCase();
          const customerStatus = status === "active" || status === "inactive" ? status : "lead";

          const customerPayload = {
            organization_id: organizationId,
            first_name: (data.first_name || "Unknown").substring(0, 100),
            last_name: (data.last_name || "").substring(0, 100),
            email: (emailIsReal ? emailRaw : `import-${row.row_number}-${importId.slice(0, 8)}@placeholder.local`).substring(0, 255),
            phone: data.phone?.toString().substring(0, 30) || null,
            address: data.address?.toString().substring(0, 255) || null,
            city: data.city?.toString().substring(0, 100) || null,
            state: data.state?.toString().substring(0, 50) || null,
            zip_code: data.zip_code?.toString().substring(0, 20) || null,
            notes: notes || null,
            customer_status: customerStatus,
          };
          let { data: created, error: insertErr } = await adminClient
            .from("customers").insert({ ...customerPayload, created_via: "migration_import" }).select("id").single();
          // Column lands with the activation migration. Import the customer
          // anyway if that SQL has not been applied yet.
          if (insertErr && /created_via/i.test(insertErr.message || "")) {
            ({ data: created, error: insertErr } = await adminClient
              .from("customers").insert(customerPayload).select("id").single());
          }
          if (insertErr) throw insertErr;
          await adminClient.from("migration_import_rows")
            .update({ status: "imported", created_record_id: created.id }).eq("id", row.id);
          imported++;

        } else if (dataType === "staff") {
          const name = `${data.first_name || ""} ${data.last_name || ""}`.trim() || data.full_name || "Imported Staff";
          // Surfaced via errorLog, which MigrationWizard already renders with a
          // row badge. Deliberately NOT counted in `skipped` — the UI labels that
          // counter "Skipped (Duplicates)" and this is not a duplicate. Row imports.
          if (data.email && !isValidEmail(data.email)) {
            errorLog.push({
              row_number: row.row_number,
              error: `Email not usable, imported without it: ${String(data.email).slice(0, 80)}`,
            });
          }
          const isActive = data.is_active === undefined ? true : !/^(false|no|inactive|0)$/i.test(String(data.is_active));
          const { data: created, error: insertErr } = await adminClient
            .from("staff").insert({
              organization_id: organizationId,
              // Validated, not trusted. This insert had no check at all, so a CSV
              // column holding a phone number, "n/a" or a merged email+phone was
              // stored verbatim and every later send to that staff member failed.
              // An unusable value becomes NULL and is reported per row rather than
              // blocking — the name, phone and rate are still worth keeping.
              name,
              email: isValidEmail(data.email) ? String(data.email).trim().toLowerCase() : null,
              phone: data.phone || null,
              hourly_rate: data.pay_rate ? normalizeMoney(data.pay_rate) : null,
              is_active: isActive,
            }).select("id").single();
          if (insertErr) throw insertErr;
          await adminClient.from("migration_import_rows")
            .update({ status: "imported", created_record_id: created.id }).eq("id", row.id);
          imported++;

        } else if (dataType === "services") {
          const { data: created, error: insertErr } = await adminClient
            .from("services").insert({
              organization_id: organizationId,
              name: (data.name || "Imported Service").substring(0, 100),
              description: data.description?.toString().substring(0, 500) || "",
              price: normalizeMoney(data.price),
              duration: normalizeInt(data.duration, 60),
              category: data.category?.toString().substring(0, 100) || null,
              is_active: data.is_active === undefined ? true : !/^(false|no|0)$/i.test(String(data.is_active)),
            }).select("id").single();
          if (insertErr) throw insertErr;
          await adminClient.from("migration_import_rows")
            .update({ status: "imported", created_record_id: created.id }).eq("id", row.id);
          imported++;

        } else if (dataType === "bookings") {
          const customerId = await findCustomer(adminClient, organizationId, data);

          // Service lookup
          let serviceId: string | null = null;
          if (data.service_name) {
            const { data: svc } = await adminClient.from("services").select("id")
              .eq("organization_id", organizationId).ilike("name", String(data.service_name)).maybeSingle();
            serviceId = svc?.id || null;
          }

          // Staff lookup
          let staffId: string | null = null;
          if (data.staff_name) {
            const { data: st } = await adminClient.from("staff").select("id")
              .eq("organization_id", organizationId).ilike("name", `%${data.staff_name}%`).maybeSingle();
            staffId = st?.id || null;
          }

          // Date
          let scheduledAt: string;
          try {
            const dateStr = data.scheduled_date || data.date;
            const timeStr = data.scheduled_time || "09:00";
            const combined = dateStr ? (String(dateStr).includes("T") ? String(dateStr) : `${dateStr} ${timeStr}`) : new Date().toISOString();
            const d = new Date(combined);
            scheduledAt = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
          } catch {
            scheduledAt = new Date().toISOString();
          }

          const duration = data.duration ? normalizeInt(data.duration, 120)
            : data.duration_hours ? Math.round(parseFloat(data.duration_hours) * 60) : 120;

          const { data: created, error: insertErr } = await adminClient
            .from("bookings").insert({
              organization_id: organizationId,
              customer_id: customerId, service_id: serviceId, staff_id: staffId,
              scheduled_at: scheduledAt,
              duration,
              total_amount: normalizeMoney(data.total_amount),
              subtotal: data.subtotal ? normalizeMoney(data.subtotal) : null,
              tax_amount: data.tax_amount ? normalizeMoney(data.tax_amount) : null,
              tip_amount: data.tip_amount ? normalizeMoney(data.tip_amount) : null,
              discount_amount: data.discount_amount ? normalizeMoney(data.discount_amount) : null,
              status: normalizeStatus(data.status),
              payment_status: normalizePaymentStatus(data.payment_status),
              address: data.address || null,
              city: data.city || null,
              state: data.state || null,
              zip_code: data.zip_code || null,
              bedrooms: data.bedrooms ? String(data.bedrooms) : null,
              bathrooms: data.bathrooms ? String(data.bathrooms) : null,
              square_footage: data.square_footage ? String(data.square_footage) : null,
              extras: parseExtras(data.extras),
              frequency: data.frequency ? normalizeFrequency(data.frequency) : "one_time",
              notes: data.notes ? `[Imported] ${data.notes}` : "[Imported from migration]",
            }).select("id").single();
          if (insertErr) throw insertErr;
          await adminClient.from("migration_import_rows")
            .update({ status: "imported", created_record_id: created.id }).eq("id", row.id);
          imported++;

        } else if (dataType === "recurring_plans") {
          const customerId = await findCustomer(adminClient, organizationId, data);
          if (!customerId) {
            await adminClient.from("migration_import_rows")
              .update({ status: "error", validation_errors: [{ message: "Customer not found — import customers first" }] })
              .eq("id", row.id);
            errors++; errorLog.push({ row_number: row.row_number, error: "Customer not found" });
            continue;
          }

          let serviceId: string | null = null;
          if (data.service_name) {
            const { data: svc } = await adminClient.from("services").select("id")
              .eq("organization_id", organizationId).ilike("name", String(data.service_name)).maybeSingle();
            serviceId = svc?.id || null;
          }
          let staffId: string | null = null;
          if (data.staff_name) {
            const { data: st } = await adminClient.from("staff").select("id")
              .eq("organization_id", organizationId).ilike("name", `%${data.staff_name}%`).maybeSingle();
            staffId = st?.id || null;
          }

          let nextScheduledAt: string | null = null;
          if (data.start_date) {
            const d = new Date(String(data.start_date));
            if (!Number.isNaN(d.getTime())) nextScheduledAt = d.toISOString();
          }

          const { data: created, error: insertErr } = await adminClient
            .from("recurring_bookings").insert({
              organization_id: organizationId,
              customer_id: customerId, service_id: serviceId, staff_id: staffId,
              frequency: normalizeFrequency(data.frequency) === "one_time" ? "weekly" : normalizeFrequency(data.frequency),
              preferred_day: dayOfWeekFromString(data.preferred_day),
              preferred_time: data.preferred_time?.toString() || null,
              address: data.address || null,
              city: data.city || null,
              state: data.state || null,
              zip_code: data.zip_code || null,
              bedrooms: data.bedrooms ? String(data.bedrooms) : null,
              bathrooms: data.bathrooms ? String(data.bathrooms) : null,
              square_footage: data.square_footage ? String(data.square_footage) : null,
              total_amount: normalizeMoney(data.total_amount),
              is_active: true,
              next_scheduled_at: nextScheduledAt,
              notes: data.notes ? `[Imported] ${data.notes}` : null,
            }).select("id").single();
          if (insertErr) throw insertErr;

          // Mark customer as recurring
          await adminClient.from("customers").update({ is_recurring: true }).eq("id", customerId);

          await adminClient.from("migration_import_rows")
            .update({ status: "imported", created_record_id: created.id }).eq("id", row.id);
          imported++;

        } else if (dataType === "property_notes") {
          const customerId = await findCustomer(adminClient, organizationId, data);
          if (!customerId) {
            await adminClient.from("migration_import_rows")
              .update({ status: "error", validation_errors: [{ message: "Customer not found — import customers first" }] })
              .eq("id", row.id);
            errors++; errorLog.push({ row_number: row.row_number, error: "Customer not found" });
            continue;
          }

          const hasPets = data.has_pets !== undefined
            ? /^(true|yes|1|y)$/i.test(String(data.has_pets))
            : Boolean(data.pet_notes);

          // Upsert on (organization_id, customer_id)
          const { data: created, error: upsertErr } = await adminClient
            .from("property_notes")
            .upsert({
              organization_id: organizationId,
              customer_id: customerId,
              notes: data.notes || null,
              access_instructions: data.access_instructions || null,
              gate_code: data.gate_code || null,
              alarm_code: data.alarm_code || null,
              has_pets: hasPets,
              pet_notes: data.pet_notes || null,
              parking_notes: data.parking_notes || null,
            }, { onConflict: "organization_id,customer_id" })
            .select("id").single();
          if (upsertErr) throw upsertErr;
          await adminClient.from("migration_import_rows")
            .update({ status: "imported", created_record_id: created.id }).eq("id", row.id);
          imported++;
        }
      } catch (err: any) {
        errors++;
        errorLog.push({ row_number: row.row_number, error: err.message || "Unknown error" });
        await adminClient.from("migration_import_rows")
          .update({ status: "error", validation_errors: [{ message: err.message }] })
          .eq("id", row.id);
      }
    }

    await adminClient.from("migration_imports").update({
      status: "completed",
      imported_rows: imported, skipped_rows: skipped, error_rows: errors,
      error_log: errorLog, completed_at: new Date().toISOString(),
      import_summary: { imported, skipped, errors, total: (rows || []).length },
    }).eq("id", importId);

    return new Response(JSON.stringify({
      success: true, imported, skipped, errors,
      // Capped for payload size, but the caller is TOLD it was capped. The bare
      // slice(0,10) showed ten problems from a 500-row import and dropped the
      // rest with no indication, so an operator fixing ten rows and re-importing
      // would meet the next thirty one at a time.
      errorLog: errorLog.slice(0, 10),
      errorLogTotal: errorLog.length,
      errorLogTruncated: errorLog.length > 10,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("process-migration-import error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
