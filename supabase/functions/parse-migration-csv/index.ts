import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Known field mappings for BookingKoala and Jobber CSV exports
const KNOWN_MAPPINGS: Record<string, Record<string, string>> = {
  customers: {
    // Names
    "client name": "full_name", "customer name": "full_name", "name": "full_name", "full name": "full_name",
    "first name": "first_name", "fname": "first_name", "given name": "first_name",
    "last name": "last_name", "lname": "last_name", "surname": "last_name", "family name": "last_name",
    // Contact
    "client email": "email", "customer email": "email", "email": "email", "email address": "email", "primary email": "email",
    "client phone": "phone", "customer phone": "phone", "phone": "phone", "phone number": "phone",
    "mobile": "phone", "mobile phone": "phone", "primary phone": "phone", "cell": "phone", "cell phone": "phone",
    // Address
    "client address": "address", "customer address": "address", "address": "address",
    "street": "address", "street address": "address", "address 1": "address", "address line 1": "address",
    "city": "city", "town": "city",
    "state": "state", "province": "state", "region": "state",
    "zip": "zip_code", "zip code": "zip_code", "zipcode": "zip_code", "postal code": "zip_code", "postcode": "zip_code",
    // Meta
    "notes": "notes", "client notes": "notes", "customer notes": "notes", "internal notes": "notes",
    "tags": "tags", "labels": "tags", "client tags": "tags",
    "company": "company_name", "company name": "company_name", "business name": "company_name",
    "status": "customer_status", "client status": "customer_status",
    "lifetime value": "lifetime_value", "total spent": "lifetime_value",
  },
  staff: {
    "name": "full_name", "full name": "full_name", "team member": "full_name", "employee name": "full_name",
    "first name": "first_name", "last name": "last_name",
    "email": "email", "email address": "email",
    "phone": "phone", "phone number": "phone", "mobile": "phone",
    "pay rate": "pay_rate", "hourly rate": "pay_rate", "rate": "pay_rate", "wage": "pay_rate",
    "role": "role", "title": "role", "position": "role",
    "active": "is_active", "status": "is_active",
  },
  bookings: {
    // Customer match keys
    "client": "customer_name", "client name": "customer_name", "customer": "customer_name", "customer name": "customer_name",
    "client email": "customer_email", "customer email": "customer_email", "email": "customer_email",
    "client phone": "customer_phone", "customer phone": "customer_phone", "phone": "customer_phone",
    // Service
    "service": "service_name", "service name": "service_name", "service type": "service_name", "job type": "service_name",
    // Schedule
    "date": "scheduled_date", "scheduled date": "scheduled_date", "appointment date": "scheduled_date",
    "booking date": "scheduled_date", "job date": "scheduled_date", "start date": "scheduled_date",
    "time": "scheduled_time", "scheduled time": "scheduled_time", "start time": "scheduled_time", "appointment time": "scheduled_time",
    "duration": "duration", "length": "duration", "duration (min)": "duration", "hours": "duration_hours",
    // Money
    "price": "total_amount", "total": "total_amount", "amount": "total_amount", "total amount": "total_amount",
    "subtotal": "subtotal", "tax": "tax_amount", "tip": "tip_amount", "discount": "discount_amount",
    "payment status": "payment_status", "paid": "payment_status",
    // Status / assignment
    "status": "status", "booking status": "status", "job status": "status",
    "address": "address", "service address": "address", "job address": "address",
    "city": "city", "state": "state", "zip": "zip_code", "zip code": "zip_code",
    "cleaner": "staff_name", "assigned to": "staff_name", "provider": "staff_name", "team member": "staff_name", "assigned": "staff_name",
    // Property details
    "bedrooms": "bedrooms", "beds": "bedrooms", "br": "bedrooms",
    "bathrooms": "bathrooms", "baths": "bathrooms", "ba": "bathrooms",
    "square footage": "square_footage", "sqft": "square_footage", "sq ft": "square_footage", "size": "square_footage",
    "extras": "extras", "add-ons": "extras", "addons": "extras",
    // Recurrence / notes
    "frequency": "frequency", "recurring": "frequency", "repeat": "frequency",
    "notes": "notes", "booking notes": "notes", "job notes": "notes", "internal notes": "notes",
  },
  services: {
    "name": "name", "service name": "name", "service": "name", "service type": "name",
    "description": "description", "details": "description",
    "price": "price", "rate": "price", "cost": "price", "base price": "price",
    "duration": "duration", "time": "duration", "length": "duration", "default duration": "duration",
    "category": "category", "type": "category",
    "active": "is_active",
  },
  recurring_plans: {
    "client": "customer_name", "client name": "customer_name", "customer": "customer_name", "customer name": "customer_name",
    "client email": "customer_email", "customer email": "customer_email", "email": "customer_email",
    "client phone": "customer_phone", "customer phone": "customer_phone", "phone": "customer_phone",
    "service": "service_name", "service name": "service_name",
    "frequency": "frequency", "recurring": "frequency", "repeat": "frequency", "schedule": "frequency",
    "preferred day": "preferred_day", "day": "preferred_day", "day of week": "preferred_day",
    "preferred time": "preferred_time", "time": "preferred_time", "start time": "preferred_time",
    "start date": "start_date", "next date": "start_date", "next scheduled": "start_date",
    "price": "total_amount", "total": "total_amount", "amount": "total_amount",
    "bedrooms": "bedrooms", "bathrooms": "bathrooms", "sqft": "square_footage", "square footage": "square_footage",
    "address": "address", "city": "city", "state": "state", "zip": "zip_code", "zip code": "zip_code",
    "cleaner": "staff_name", "assigned to": "staff_name",
    "notes": "notes",
  },
  property_notes: {
    "client": "customer_name", "client name": "customer_name", "customer": "customer_name", "customer name": "customer_name",
    "email": "customer_email", "client email": "customer_email", "customer email": "customer_email",
    "phone": "customer_phone", "client phone": "customer_phone", "customer phone": "customer_phone",
    "notes": "notes", "property notes": "notes", "home notes": "notes", "internal notes": "notes",
    "access": "access_instructions", "access instructions": "access_instructions", "entry": "access_instructions", "entry instructions": "access_instructions",
    "gate code": "gate_code", "gate": "gate_code",
    "alarm code": "alarm_code", "alarm": "alarm_code", "security code": "alarm_code",
    "pets": "has_pets", "has pets": "has_pets",
    "pet notes": "pet_notes", "pet info": "pet_notes", "pet": "pet_notes",
    "parking": "parking_notes", "parking notes": "parking_notes", "parking instructions": "parking_notes",
  },
};

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim()); current = "";
      } else { current += ch; }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });

  return { headers, rows };
}

function autoMapFields(headers: string[], dataType: string): Record<string, string> {
  const knownMap = KNOWN_MAPPINGS[dataType] || {};
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    if (knownMap[normalized]) mapping[header] = knownMap[normalized];
  }
  return mapping;
}

// Real email format. Filters out junk like "My Business" or "n/a" that users type
// into the Thumbtack/CSV "email" column, which would otherwise collapse every row
// into one giant duplicate group.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(v: string | undefined | null): boolean {
  if (!v) return false;
  return EMAIL_RE.test(String(v).trim());
}

function detectDuplicates(rows: Record<string, string>[], mapping: Record<string, string>): Set<number> {
  const duplicateIndices = new Set<number>();
  const seen = new Map<string, number>();
  const emailKey = Object.entries(mapping).find(([_, v]) => v === "email" || v === "customer_email")?.[0];
  const phoneKey = Object.entries(mapping).find(([_, v]) => v === "phone" || v === "customer_phone")?.[0];

  // First pass: count email occurrences. If the same email appears 3+ times it's
  // almost certainly a placeholder (e.g. user typed their business name) — skip it
  // for dedup so legitimate distinct leads aren't flagged as duplicates.
  const emailCounts = new Map<string, number>();
  if (emailKey) {
    for (const row of rows) {
      const raw = row[emailKey];
      if (!isValidEmail(raw)) continue;
      const k = String(raw).toLowerCase().trim();
      emailCounts.set(k, (emailCounts.get(k) || 0) + 1);
    }
  }

  rows.forEach((row, index) => {
    const keys: string[] = [];
    if (emailKey) {
      const raw = row[emailKey];
      if (isValidEmail(raw)) {
        const e = String(raw).toLowerCase().trim();
        if ((emailCounts.get(e) || 0) < 3) keys.push(`email:${e}`);
      }
    }
    if (phoneKey && row[phoneKey]) {
      const digits = row[phoneKey].replace(/\D/g, "");
      if (digits.length >= 7) keys.push(`phone:${digits.slice(-10)}`);
    }
    for (const key of keys) {
      if (seen.has(key)) duplicateIndices.add(index);
      else seen.set(key, index);
    }
  });

  return duplicateIndices;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // 401 before the body. A missing Authorization header used to hit
    // `authHeader.replace` and return 500 "Cannot read properties of null".
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: {
      csvContent?: string;
      dataType?: string;
      source?: string;
      organizationId?: string;
      filename?: string;
    } | null = null;
    try {
      parsed = await req.json();
    } catch {
      parsed = null;
    }
    const { csvContent, dataType, source, organizationId, filename } = parsed ?? {};

    if (!csvContent || !dataType || !source || !organizationId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // getUser(token) validates the JWT but does not attach it to this client,
    // so a membership read here runs as anon and RLS returns no row — every
    // signed-in owner then got 403. The service-role client checks membership.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: membership, error: membershipError } = await adminClient
      .from("org_memberships").select("role")
      .eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();

    if (membershipError) {
      console.error("[parse-migration-csv] membership lookup failed:", membershipError);
      return new Response(JSON.stringify({ error: "Could not verify organization access" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!membership || !["owner", "admin", "manager"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Not authorized for this organization" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { headers, rows } = parseCSV(csvContent);
    if (headers.length === 0 || rows.length === 0) {
      return new Response(JSON.stringify({ error: "CSV file is empty or has no data rows" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fieldMapping = autoMapFields(headers, dataType);
    const duplicates = detectDuplicates(rows, fieldMapping);

    const { data: importRecord, error: importError } = await adminClient
      .from("migration_imports")
      .insert({
        organization_id: organizationId,
        source, data_type: dataType, status: "mapping",
        original_filename: filename || "unknown.csv",
        total_rows: rows.length,
        duplicate_rows: duplicates.size,
        field_mapping: fieldMapping,
      })
      .select().single();

    if (importError) throw importError;

    const batchSize = 100;
    let rowsFailedToSave = 0;
    const failedBatchRanges: string[] = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize).map((row, batchIndex) => {
        const rowIndex = i + batchIndex;
        const mappedData: Record<string, string> = {};
        for (const [csvCol, targetField] of Object.entries(fieldMapping)) {
          if (row[csvCol]) mappedData[targetField] = row[csvCol];
        }
        if (mappedData.full_name && !mappedData.first_name) {
          const parts = mappedData.full_name.trim().split(/\s+/);
          mappedData.first_name = parts[0] || "";
          mappedData.last_name = parts.slice(1).join(" ") || "";
        }
        return {
          import_id: importRecord.id,
          organization_id: organizationId,
          row_number: rowIndex + 1,
          raw_data: row,
          mapped_data: mappedData,
          status: duplicates.has(rowIndex) ? "duplicate" : "valid",
        };
      });
      const { error: batchInsertErr } = await adminClient.from("migration_import_rows").insert(batch);
      if (batchInsertErr) {
        // Don't let a mid-import batch failure pass as a clean import —
        // the customer's CSV would silently be missing rows with no
        // visible sign anything went wrong.
        rowsFailedToSave += batch.length;
        failedBatchRanges.push(`${i + 1}-${i + batch.length}`);
        console.error(`[parse-migration-csv] Batch insert failed for rows ${i + 1}-${i + batch.length} (import ${importRecord.id}):`, batchInsertErr);
      }
    }

    if (rowsFailedToSave > 0) {
      console.error(`[parse-migration-csv] Import ${importRecord.id}: ${rowsFailedToSave} of ${rows.length} rows failed to save (row ranges: ${failedBatchRanges.join(", ")})`);
    }

    return new Response(JSON.stringify({
      importId: importRecord.id,
      totalRows: rows.length,
      duplicateRows: duplicates.size,
      rowsFailedToSave,
      ...(rowsFailedToSave > 0 ? {
        warning: `${rowsFailedToSave} of ${rows.length} rows could not be saved and are missing from this import — please re-upload or contact support.`,
      } : {}),
      headers, fieldMapping,
      preview: rows.slice(0, 5),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("parse-migration-csv error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
