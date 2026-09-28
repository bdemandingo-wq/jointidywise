import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';

interface OrgTimestampProps {
  value: Date | string;
  organizationId?: string | null;
  className?: string;
}

/** Displays a stored instant in the active business timezone with its abbreviation. */
export function OrgTimestamp({ value, organizationId, className }: OrgTimestampProps) {
  const { timezone } = useOrgTimezone(organizationId);

  return <time className={className} dateTime={new Date(value).toISOString()}>{formatTimestampWithZone(value, timezone)}</time>;
}