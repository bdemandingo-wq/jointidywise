DROP POLICY IF EXISTS "Org admins can manage manual_payments" ON public.manual_payments;
DROP POLICY IF EXISTS "Authenticated org admins can manage payroll" ON public.payroll_payments;
DROP POLICY IF EXISTS "Org admins can manage payroll payments" ON public.payroll_payments;