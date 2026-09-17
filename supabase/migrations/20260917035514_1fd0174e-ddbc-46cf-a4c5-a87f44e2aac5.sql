-- Column-level grants cannot distinguish owners from managers (both are the
-- `authenticated` role), so restoring write grants; the owner-only triggers
-- guard_staff_compensation_fields / guard_staff_wage_updates do the enforcing.
GRANT INSERT (ssn_last4, ein, tax_document_url, base_wage), UPDATE (ssn_last4, ein, tax_document_url, base_wage)
  ON public.staff TO authenticated;