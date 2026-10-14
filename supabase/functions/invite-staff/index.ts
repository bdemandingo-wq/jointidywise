import { sendResendEmail } from "../_shared/send-resend.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_FROM } from "../_shared/email-sender-resolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteStaffRequest {
  organizationId?: string;
  email: string;
  name: string;
  phone?: string;
  hourly_rate?: number;
  percentage_rate?: number;
  default_hours?: number;
  tax_classification?: 'w2' | '1099';
  password?: string;
}

// Helper to log to system_logs
async function logToSystem(
  level: 'info' | 'warn' | 'error',
  message: string,
  details?: Record<string, unknown>,
  userId?: string,
  organizationId?: string
) {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    await supabaseAdmin.from("system_logs").insert([
      {
        level,
        source: "invite-staff",
        message,
        details: details ?? null,
        user_id: userId || null,
        organization_id: organizationId || null,
      },
    ]);
  } catch (err) {
    console.error("Failed to log:", err);
  }
}

// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let adminUserId: string | undefined;
  let organizationId: string | undefined;
  let createdAuthUserId: string | undefined;

  try {
    // Verify the requesting user is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      await logToSystem('warn', 'Invalid token provided', { error: authError?.message });
      return new Response(JSON.stringify({ error: "Session expired. Please log in again." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    adminUserId = user.id;

    // NOTE: Permissions are validated using org_memberships for the requested organization
    // (owners/admins can invite staff). We validate after parsing the request body.

    // Parse and validate request body
    let requestBody: InviteStaffRequest;
    try {
      requestBody = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request format." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, name, phone, hourly_rate, percentage_rate, default_hours, tax_classification, password } = requestBody;

    // Validate required fields
    if (!email || !name) {
      return new Response(JSON.stringify({ error: "Name and email are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: "Please enter a valid email address." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate password
    if (!password || password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate name length
    if (name.trim().length < 2 || name.trim().length > 100) {
      return new Response(JSON.stringify({ error: "Name must be between 2 and 100 characters." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine organization: prefer from request body, fallback to user's membership
    if (requestBody.organizationId) {
      organizationId = requestBody.organizationId;
    } else {
      // Fallback: get the first organization for this user
      const { data: adminMemberships, error: membershipError } = await supabaseAdmin
        .from("org_memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1);

      if (membershipError || !adminMemberships || adminMemberships.length === 0) {
        await logToSystem('error', 'Admin has no organization', { userId: user.id, error: membershipError?.message });
        return new Response(JSON.stringify({ error: "Unable to find your organization. Please contact support." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      organizationId = adminMemberships[0].organization_id;
    }

    // Verify admin has owner/admin role in this organization
    const { data: adminRole, error: roleCheckError } = await supabaseAdmin
      .from("org_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (roleCheckError || !adminRole) {
      await logToSystem('warn', 'User not a member of organization', { userId: user.id, organizationId });
      return new Response(JSON.stringify({ error: "You are not a member of this organization." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (adminRole.role !== 'owner' && adminRole.role !== 'admin') {
      await logToSystem('warn', 'Non-admin attempted staff invite', { userId: user.id, organizationId, role: adminRole.role });
      return new Response(JSON.stringify({ error: "You need admin permissions to add staff members." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Creating staff for organization:", organizationId, "by user with role:", adminRole.role);

    // Check if staff record already exists (including inactive ones) in this org
    const { data: existingStaff } = await supabaseAdmin
      .from("staff")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .eq("organization_id", organizationId)
      .single();

    if (existingStaff) {
      // Staff exists - reactivate if inactive
      if (!existingStaff.is_active) {
        const { error: updateError } = await supabaseAdmin
          .from("staff")
          .update({
            name: name.trim(),
            phone: phone || null,
            hourly_rate: hourly_rate || null,
            percentage_rate: percentage_rate || null,
            default_hours: default_hours || 5,
            is_active: true,
            tax_classification: tax_classification || 'w2',
          })
          .eq("id", existingStaff.id);

        if (updateError) {
          await logToSystem('error', 'Failed to reactivate staff', { staffId: existingStaff.id, error: updateError.message }, adminUserId, organizationId);
          return new Response(JSON.stringify({ error: "Failed to reactivate staff member. Please try again." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        await logToSystem('info', 'Staff member reactivated', { staffId: existingStaff.id, email }, adminUserId, organizationId);

        return new Response(
          JSON.stringify({
            success: true,
            staff: { ...existingStaff, is_active: true, name, phone, hourly_rate },
            message: "Staff member reactivated successfully!",
            reactivated: true,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      } else {
        // Treat retries as success. The original request may have completed even
        // if the browser timed out before receiving its response.
        return new Response(JSON.stringify({
          success: true,
          staff: existingStaff,
          alreadyExists: true,
          existingAccount: true,
          message: "This staff member is already active in your organization.",
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check if auth user already exists (they might exist without a staff record in this org).
    // listUsers() is paginated (default 50/page) — a bare call misses users in large projects,
    // which caused createUser to fail with 422 email_exists and a generic error.
    const normalizedEmail = email.toLowerCase().trim();
    const findAuthUserByEmail = async () => {
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const match = data?.users?.find(u => u.email?.toLowerCase() === normalizedEmail);
        if (match) return match;
        if (!data?.users || data.users.length < 1000) return null;
      }
      return null;
    };

    const existingAuthUser = await findAuthUserByEmail();


    let userId: string;
    let wasNewUserCreated = false;
    let linkedExistingAccount = false;

    if (existingAuthUser) {
      // One cleaner can work for multiple organizations with one login.
      // Never let a second organization replace that cleaner's global password.
      console.log("User already exists in auth, linking to staff record:", existingAuthUser.id);
      userId = existingAuthUser.id;
      linkedExistingAccount = true;
    } else {
      let linkedExistingUser = false;
      // Create new auth user with admin-provided password
      let { data: authData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: name.trim() },
      });

      if (createUserError) {
        const errorMsg = (createUserError.message || "").toLowerCase();
        const emailExists =
          errorMsg.includes("already registered") ||
          errorMsg.includes("already exists") ||
          (createUserError as { code?: string }).code === "email_exists";

        if (emailExists) {
          // Race / lookup miss: the user does exist — link to them instead of failing.
          const found = await findAuthUserByEmail();
          if (found) {
            authData = { user: found } as typeof authData;
            createUserError = null;
            linkedExistingUser = true;
            linkedExistingAccount = true;
          } else {
            await logToSystem('error', 'Failed to create auth user', { email, error: createUserError.message }, adminUserId, organizationId);
            return new Response(JSON.stringify({ error: "This email is already registered to another account and could not be linked. Please use a different email." }), {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } else {
          await logToSystem('error', 'Failed to create auth user', { email, error: createUserError.message }, adminUserId, organizationId);
          return new Response(JSON.stringify({ error: `Failed to create user account: ${createUserError.message}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      userId = authData!.user!.id;

      // Only mark for rollback-delete if we actually created the account here.
      if (!linkedExistingUser) {
        createdAuthUserId = userId;
        wasNewUserCreated = true;
      }

    }

    // Create staff record
    const { data: staffData, error: staffError } = await supabaseAdmin
      .from("staff")
      .insert({
        user_id: userId,
        organization_id: organizationId,
        email: email.toLowerCase().trim(),
        name: name.trim(),
        phone: phone || null,
        hourly_rate: hourly_rate || null,
        percentage_rate: percentage_rate || null,
        default_hours: default_hours || 5,
        is_active: true,
        tax_classification: tax_classification || 'w2',
      })
      .select()
      .single();

    if (staffError) {
      await logToSystem('error', 'Failed to create staff record', { userId, email, error: staffError.message }, adminUserId, organizationId);
      
      // ROLLBACK: Delete auth user if we just created them
      if (wasNewUserCreated && createdAuthUserId) {
        console.log("Rolling back: deleting newly created auth user", createdAuthUserId);
        await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
      }
      
      return new Response(JSON.stringify({ error: "Failed to create staff record. Please try again." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Assign staff role (upsert to handle existing users)
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({
        user_id: userId,
        role: "staff",
      }, { onConflict: 'user_id,role' });

    if (roleError) {
      console.error("Error assigning role:", roleError);
      await logToSystem('warn', 'Failed to assign staff role', { userId, error: roleError.message }, adminUserId, organizationId);
    }

    // Also add to org_memberships so they can access org data
    const { error: orgMembershipError } = await supabaseAdmin
      .from("org_memberships")
      .upsert({
        user_id: userId,
        organization_id: organizationId,
        role: "member",
      }, { onConflict: 'organization_id,user_id' });

    if (orgMembershipError) {
      console.error("Error creating org membership:", orgMembershipError);
      await logToSystem('warn', 'Failed to create org membership', { userId, error: orgMembershipError.message }, adminUserId, organizationId);
    }

    await logToSystem('info', 'Staff member created successfully', { staffId: staffData.id, email, wasNewUser: wasNewUserCreated }, adminUserId, organizationId);

    // Email the new staff member their login credentials so the admin
    // doesn't have to manually copy/text them. Fire-and-forget — failure
    // here must NOT block the invite (admin can always resend manually).
    try {
      // Pull org name for sender context
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();
      const orgName = org?.name || "your team";
      const loginUrl = "https://www.jointidywise.com/staff/login";
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const firstName = name.trim().split(" ")[0] || "there";

      // Existing users keep their current password; only newly created users
      // should receive the temporary password entered by this organization.
      // Built INTO the template rather than string-replaced after the fact —
      // the old html.replace() never matched (indentation differed by one
      // space), so linked accounts were emailed a temp password that was
      // never written to auth.
      const credentialRows = linkedExistingAccount
        ? `<tr><td colspan="2" style="padding: 8px;">Use your existing TidyWise email and password to sign in.</td></tr>`
        : `<tr><td style="padding: 8px;"><strong>Email:</strong></td><td style="padding: 8px;">${esc(email)}</td></tr>
            <tr><td style="padding: 8px;"><strong>Temporary password:</strong></td><td style="padding: 8px; font-family: monospace;">${esc(password!)}</td></tr>`;
      const passwordNotice = linkedExistingAccount
        ? `<strong>Your existing password has not changed.</strong>`
        : `<strong>Please change your password</strong> after signing in for the first time.`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a; margin: 0 0 12px;">Welcome to ${esc(orgName)}, ${esc(firstName)} 👋</h2>
          <p style="color: #333; line-height: 1.6;">
            You've been added as a team member. Use the credentials below to
            sign in to your staff portal and start picking up jobs.
          </p>
          <table style="border-collapse: collapse; margin: 16px 0; background: #f5f5f5; padding: 12px; width: 100%; max-width: 400px;">
            ${credentialRows}
          </table>
          <p style="margin: 16px 0;">
            <a href="${loginUrl}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px;">Sign in to staff portal</a>
          </p>
          <p style="color: #92400e; background: #fff7ed; border-left: 4px solid #f59e0b; padding: 12px 16px; line-height: 1.5;">
            ${passwordNotice}
          </p>
          <p style="color: #555; margin-top: 24px;">— ${esc(orgName)}</p>
        </div>`;

      // Try Resend directly with platform key (works regardless of org email setup).
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        await sendResendEmail( { organizationId: organizationId,
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: PLATFORM_SENDER_FROM,
            to: [email.toLowerCase().trim()],
            reply_to: tidywiseSupportEmail(),
            subject: `Welcome to ${orgName} — your staff login`,
            html: emailHtml,
          }),
        });
        await logToSystem('info', 'Staff welcome email sent', { staffId: staffData.id, email }, adminUserId, organizationId);
      } else {
        console.warn("[invite-staff] RESEND_API_KEY not set — skipping welcome email");
      }
    } catch (emailErr) {
      console.error("[invite-staff] Welcome email failed (non-fatal):", emailErr);
      await logToSystem('warn', 'Staff welcome email failed', { staffId: staffData.id, error: String(emailErr) }, adminUserId, organizationId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        staff: staffData,
        existingAccount: linkedExistingAccount,
        message: "Staff member created successfully!",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in invite-staff:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    
    await logToSystem('error', 'Unexpected error in invite-staff', { error: message, stack: error instanceof Error ? error.stack : undefined }, adminUserId, organizationId);
    
    // ROLLBACK: Clean up if we created an auth user but something else failed
    if (createdAuthUserId) {
      console.log("Rolling back: deleting newly created auth user after error", createdAuthUserId);
      try {
        await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
      } catch (cleanupError) {
        console.error("Failed to clean up auth user:", cleanupError);
      }
    }
    
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
