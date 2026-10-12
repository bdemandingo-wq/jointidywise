ALTER TABLE public.migration_imports
  DROP CONSTRAINT IF EXISTS migration_imports_data_type_check;

ALTER TABLE public.migration_imports
  ADD CONSTRAINT migration_imports_data_type_check
  CHECK (data_type IN ('customers', 'staff', 'bookings', 'services', 'recurring_plans', 'property_notes'));