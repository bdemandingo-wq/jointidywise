/**
 * Toasts for cleaner job events. The edge functions report which channels
 * actually went out; these helpers turn that into a sentence that matches.
 */

export interface JobNotifyChannels {
  customerSms?: boolean;
  adminSms?: boolean;
  bell?: boolean;
  push?: boolean;
}

export interface JobNotifyResult {
  success?: boolean;
  deduplicated?: boolean;
  message?: string;
  error?: string;
  channels?: JobNotifyChannels;
  smsSkippedReason?: string | null;
  /** Older responses, before channels existed. */
  adminSent?: boolean;
  adminNotified?: boolean;
  clientSent?: boolean;
}

export interface NotifySentence {
  ok: boolean;
  message: string;
}

function officeReached(channels: JobNotifyChannels | undefined, legacy?: boolean): boolean {
  if (!channels) return !!legacy;
  return !!(channels.bell || channels.push || channels.adminSms);
}

export function describeOnTheWay(
  data: JobNotifyResult | null | undefined,
  opts: { hasTracking: boolean; hasCustomerPhone: boolean },
): NotifySentence {
  if (!data?.success) {
    return { ok: false, message: data?.error || "Couldn't send the on-the-way notice." };
  }
  if (data.deduplicated) {
    return {
      ok: true,
      message: data.message || "You've already sent the on-the-way notice for this job.",
    };
  }

  const channels = data.channels;
  const customer = channels ? !!channels.customerSms : false;
  const office = officeReached(channels, data.adminNotified || data.adminSent);

  if (!channels && data.success) {
    return {
      ok: true,
      message: opts.hasTracking
        ? 'Customer notified with a live tracking link.'
        : "Customer notified that you're on the way.",
    };
  }

  if (customer && office) {
    return {
      ok: true,
      message: opts.hasTracking
        ? 'Customer texted with a live tracking link. Office notified.'
        : "Customer texted that you're on the way. Office notified.",
    };
  }
  if (customer) {
    return { ok: true, message: "Customer texted that you're on the way." };
  }
  if (office) {
    const why = data.smsSkippedReason
      ? ` Texting isn't set up (${data.smsSkippedReason}).`
      : !opts.hasCustomerPhone
        ? ' No phone number on file for the customer.'
        : ' The customer was not texted.';
    return { ok: true, message: `Marked on the way. Office notified.${why}` };
  }
  return {
    ok: false,
    message: data.smsSkippedReason
      ? `Marked on the way, but nobody was notified. ${data.smsSkippedReason}.`
      : 'Marked on the way, but nobody was notified.',
  };
}

export function describeArrival(data: JobNotifyResult | null | undefined): NotifySentence {
  if (!data?.success) {
    return { ok: false, message: data?.error || 'Arrival not sent.' };
  }
  if (data.deduplicated) {
    return { ok: true, message: data.message || 'Arrival already recorded.' };
  }

  const channels = data.channels;
  const customer = channels ? !!channels.customerSms : !!data.clientSent;
  const office = officeReached(channels, data.adminSent);

  if (!channels && data.success && data.clientSent == null && data.adminSent == null) {
    return { ok: true, message: 'Arrival recorded.' };
  }
  if (customer && office) {
    return { ok: true, message: 'Arrival sent. Client and office notified.' };
  }
  if (office) {
    return {
      ok: true,
      message: data.smsSkippedReason
        ? `Marked arrived. Office notified (${data.smsSkippedReason}).`
        : 'Marked arrived. Office notified.',
    };
  }
  if (customer) {
    return { ok: true, message: 'Customer texted that you arrived. The office was not notified.' };
  }
  return {
    ok: false,
    message: data.smsSkippedReason
      ? `Marked arrived, but nobody was notified. ${data.smsSkippedReason}.`
      : 'Marked arrived, but nobody was notified.',
  };
}

export function describeJobComplete(data: JobNotifyResult | null | undefined): string {
  if (!data?.success) {
    return 'Job completed. The office notification failed.';
  }
  if (data.deduplicated) {
    return 'Job completed.';
  }
  const channels = data.channels;
  const office = officeReached(channels, data.adminSent);
  const texted = channels ? !!channels.adminSms : !!data.adminSent;
  if (texted && office) return 'Job completed. Office texted and notified.';
  if (office) {
    return data.smsSkippedReason
      ? 'Job completed. Office notified (texting not set up).'
      : 'Job completed. Office notified.';
  }
  return 'Job completed. The office was not notified.';
}
