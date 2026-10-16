/**
 * Copy for cleaner job events. Completion and arrival are different events.
 * Arrival is the only wording that says the cleaner arrived. Completion never
 * uses it.
 */

export type JobNotifyEvent = 'arrived' | 'completed';

export interface JobEventCopyInput {
  staffName: string;
  bookingNumber: string | number;
  customerLabel: string;
  companyName: string;
  address: string;
  /** Already formatted, including a leading newline, or empty. */
  amountSuffix: string;
}

export interface JobEventCopy {
  bellTitle: string;
  bellMessage: string;
  pushTitle: string;
  pushBody: string;
  adminSms: string;
  /** Null when this event does not text the customer. */
  customerSms: string | null;
  kind: 'arrived' | 'job_complete';
}

export function jobEventCopy(event: JobNotifyEvent, input: JobEventCopyInput): JobEventCopy {
  const job = `Booking #${input.bookingNumber}`;
  if (event === 'completed') {
    return {
      bellTitle: '✅ Job completed',
      bellMessage: `${input.staffName} completed ${job} for ${input.customerLabel}.`,
      pushTitle: `✅ ${input.staffName} completed a job`,
      pushBody: job,
      adminSms:
        `✅ ${input.staffName} completed Job #${input.bookingNumber}\n\n` +
        `Customer: ${input.customerLabel}\n` +
        `Address: ${input.address}${input.amountSuffix}`,
      customerSms: null,
      kind: 'job_complete',
    };
  }

  return {
    bellTitle: '📍 Cleaner arrived',
    bellMessage: `${input.staffName} has arrived at ${job} for ${input.customerLabel}.`,
    pushTitle: `📍 ${input.staffName} has arrived`,
    pushBody: job,
    adminSms:
      `📍 ${input.staffName} has arrived at Job #${input.bookingNumber}\n\n` +
      `Customer: ${input.customerLabel}\n` +
      `Address: ${input.address}`,
    customerSms:
      `✅ ${input.staffName} from ${input.companyName} has arrived for your appointment!\n\n${job}`,
    kind: 'arrived',
  };
}

/** A finished or cancelled job must not send the arrival template. */
export function shouldSendArrival(status: string | null | undefined): boolean {
  return status !== 'completed' && status !== 'cancelled' && status !== 'no_show';
}
