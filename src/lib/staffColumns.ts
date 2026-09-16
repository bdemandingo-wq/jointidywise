/**
 * Columns of `public.staff` that `authenticated` is allowed to SELECT.
 *
 * `ssn_last4`, `ein`, `tax_document_url` and `base_wage` are deliberately
 * absent: the table-wide SELECT grant was revoked and re-issued per column so
 * that managers (who are `authenticated` exactly like owners, and pass
 * `is_org_admin`) cannot read restricted financial/secret data. Owners reach
 * those fields through the owner-only RPCs `get_staff_sensitive_fields` and
 * `get_org_staff_wages`; a cleaner reads their own through
 * `get_my_staff_profile` / `get_my_staff_wages`.
 *
 * Any `select('*')` on `staff` — including a `staff:staff(*)` embed — now
 * fails with a permission error. Use this constant instead.
 */
export const STAFF_SELECTABLE_COLUMNS = [
  'id',
  'user_id',
  'organization_id',
  'name',
  'email',
  'phone',
  'avatar_url',
  'bio',
  'is_active',
  'hourly_rate',
  'percentage_rate',
  'default_hours',
  'tax_classification',
  'calendar_color',
  'home_address',
  'home_latitude',
  'home_longitude',
  'location_permission_status',
  'location_permission_updated_at',
  'created_at',
  'updated_at',
].join(', ');
