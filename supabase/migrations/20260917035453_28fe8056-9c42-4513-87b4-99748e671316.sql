-- Sensitive staff fields (SSN last 4, EIN, tax documents, wages) must be
-- owner-only for WRITES too, matching the owner-only SELECT column grants.
-- Both guards previously allowed managers/legacy admins through.
CREATE OR REPLACE FUNCTION public.guard_staff_compensation_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.has_org_financial_access(NEW.organization_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.hourly_rate IS DISTINCT FROM OLD.hourly_rate
     OR NEW.base_wage IS DISTINCT FROM OLD.base_wage
     OR NEW.percentage_rate IS DISTINCT FROM OLD.percentage_rate
     OR NEW.tax_classification IS DISTINCT FROM OLD.tax_classification
     OR NEW.ssn_last4 IS DISTINCT FROM OLD.ssn_last4
     OR NEW.ein IS DISTINCT FROM OLD.ein
     OR NEW.tax_document_url IS DISTINCT FROM OLD.tax_document_url
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Only the business owner can change compensation or tax fields on a staff record'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_staff_wage_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.has_org_financial_access(NEW.organization_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.base_wage          IS DISTINCT FROM OLD.base_wage
     OR NEW.hourly_rate     IS DISTINCT FROM OLD.hourly_rate
     OR NEW.percentage_rate IS DISTINCT FROM OLD.percentage_rate
     OR NEW.tax_classification IS DISTINCT FROM OLD.tax_classification
     OR NEW.ssn_last4       IS DISTINCT FROM OLD.ssn_last4
     OR NEW.ein             IS DISTINCT FROM OLD.ein
     OR NEW.tax_document_url IS DISTINCT FROM OLD.tax_document_url
  THEN
    RAISE EXCEPTION 'Only the business owner can change wage or tax fields on staff'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- Writes to the sensitive columns are now owner-only at the column level too.
REVOKE INSERT (ssn_last4, ein, tax_document_url, base_wage), UPDATE (ssn_last4, ein, tax_document_url, base_wage)
  ON public.staff FROM authenticated;