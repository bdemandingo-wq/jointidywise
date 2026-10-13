import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { captureReferralFromPath } from '@/lib/referralAttribution';

/**
 * jointidywise.com/r/CODE. Stores the code for 30 days, then continues to signup.
 */
export default function ReferralLinkPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [ready] = useState(() => {
    if (code) captureReferralFromPath(`/r/${code}`);
    return true;
  });

  useEffect(() => {
    if (!ready) return;
    navigate('/signup', { replace: true });
  }, [navigate, ready]);

  return null;
}
