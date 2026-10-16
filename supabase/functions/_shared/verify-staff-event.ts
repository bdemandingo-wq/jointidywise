// Authorizes a cleaner-initiated job event (on the way, arrived, complete).
//
// Cleaners often have no org_memberships row, so a membership-only check
// rejects the person who is actually at the job. The caller must be either
// that staff user's own login, or an owner/admin/manager of the org. The
// staff row must belong to the booking's organization and be assigned to
// the booking (primary staff_id or a team assignment).

import { isServiceRoleRequest } from "./require-caller-org.ts";

type AdminClient = {
  // Widened from the real query builder. Matching PostgrestFilterBuilder
  // structurally makes `deno check` instantiate that generic forever.
  from: (table: string) => any;
  auth: {
    getUser: (jwt: string) => Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
};

export async function assertAssignedStaffEvent(
  req: Request,
  supabase: AdminClient,
  organizationId: string,
  staffId: string,
  bookingId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: staff, error: staffErr } = await supabase
    .from("staff")
    .select("id, organization_id, user_id")
    .eq("id", staffId)
    .maybeSingle();

  if (staffErr || !staff || staff.organization_id !== organizationId) {
    return { ok: false, status: 403, error: "Staff does not belong to this organization" };
  }

  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, staff_id, organization_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingErr || !booking || booking.organization_id !== organizationId) {
    return { ok: false, status: 404, error: "Booking not found" };
  }

  const { data: team } = await supabase
    .from("booking_team_assignments")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("staff_id", staffId)
    .maybeSingle();

  const assigned = booking.staff_id === staffId || !!team;
  if (!assigned) {
    return { ok: false, status: 403, error: "Staff is not assigned to this booking" };
  }

  if (isServiceRoleRequest(req)) return { ok: true };

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token) return { ok: false, status: 401, error: "Missing Authorization header" };

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: "Invalid or expired token" };
  }
  const userId = userData.user.id;

  if (staff.user_id && staff.user_id === userId) return { ok: true };

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const role = membership?.role as string | undefined;
  if (role && ["owner", "admin", "manager"].includes(role)) return { ok: true };

  return { ok: false, status: 403, error: "Not allowed to send this notification" };
}
