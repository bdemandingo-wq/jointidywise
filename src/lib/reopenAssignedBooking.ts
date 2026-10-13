import { supabase } from '@/lib/supabase';

interface ReopenRpc {
  rpc: (
    fn: 'reopen_assigned_booking',
    args: { p_booking_id: string },
  ) => Promise<{ data: { success?: boolean; already_open?: boolean } | null; error: { message: string } | null }>;
}

/** Calls the security-definer reopen. The function checks the caller itself. */
export function reopenAssignedBooking(bookingId: string) {
  const client = supabase as unknown as ReopenRpc;
  return client.rpc('reopen_assigned_booking', { p_booking_id: bookingId });
}
