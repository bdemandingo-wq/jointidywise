-- Org-owner referral programme.
--
-- public.referrals already tracks customer-to-customer credits, so this
-- programme does not reuse that table. The ledger with statuses
-- signed_up, trialing, paid, rewarded, reversed is public.referral_signups.
-- referral_codes is one shareable code per organization.
-- referral_rewards is one free month per two paying referrals.

alter table public.organizations
  add column if not exists referred_by uuid references public.organizations(id) on delete set null;

create index if not exists organizations_referred_by_idx
  on public.organizations (referred_by);

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now(),
  constraint referral_codes_format check (code ~ '^[A-HJ-NP-Z2-9]{8}$')
);

create table if not exists public.referral_signups (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.referral_codes(id) on delete cascade,
  code text not null,
  referrer_org_id uuid not null references public.organizations(id) on delete cascade,
  referred_org_id uuid not null unique references public.organizations(id) on delete cascade,
  referred_user_id uuid,
  referred_email text,
  referred_org_name text,
  status text not null default 'signed_up'
    check (status in ('signed_up', 'trialing', 'paid', 'rewarded', 'reversed')),
  block_reason text,
  qualifying_invoice_id text unique,
  qualifying_charge_id text,
  stripe_customer_id text,
  paid_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referral_signups_referrer_status_idx
  on public.referral_signups (referrer_org_id, status, id);
create index if not exists referral_signups_charge_idx
  on public.referral_signups (qualifying_charge_id);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reward_index integer not null,
  months integer not null default 1 check (months = 1),
  status text not null default 'banked'
    check (status in ('banked', 'applied', 'reversed')),
  amount_cents integer,
  currency text not null default 'usd',
  stripe_balance_transaction_id text,
  stripe_customer_id text,
  source_referral_ids uuid[] not null,
  applied_at timestamptz,
  reversed_at timestamptz,
  reversal_balance_transaction_id text,
  created_at timestamptz not null default now(),
  constraint referral_rewards_once unique (organization_id, reward_index)
);

create index if not exists referral_rewards_org_status_idx
  on public.referral_rewards (organization_id, status, reward_index);

grant select on public.referral_codes to authenticated;
grant all on public.referral_codes to service_role;
grant select on public.referral_signups to authenticated;
grant all on public.referral_signups to service_role;
grant select on public.referral_rewards to authenticated;
grant all on public.referral_rewards to service_role;

alter table public.referral_codes enable row level security;
alter table public.referral_signups enable row level security;
alter table public.referral_rewards enable row level security;

create policy "members read own referral code"
  on public.referral_codes
  for select to authenticated
  using (exists (
    select 1 from public.org_memberships m
    where m.organization_id = referral_codes.organization_id
      and m.user_id = auth.uid()
  ));

create policy "referrer reads own saas referrals"
  on public.referral_signups
  for select to authenticated
  using (exists (
    select 1 from public.org_memberships m
    where m.organization_id = referral_signups.referrer_org_id
      and m.user_id = auth.uid()
  ));

create policy "platform admin reads saas referrals"
  on public.referral_signups
  for select to authenticated
  using (public.is_platform_admin());

create policy "members read own referral rewards"
  on public.referral_rewards
  for select to authenticated
  using (exists (
    select 1 from public.org_memberships m
    where m.organization_id = referral_rewards.organization_id
      and m.user_id = auth.uid()
  ));

create policy "platform admin reads referral rewards"
  on public.referral_rewards
  for select to authenticated
  using (public.is_platform_admin());

-- Codes are minted here, not by the client. The function is not granted to
-- authenticated: it runs only as the trigger, as the table owner.
create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..8 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

create or replace function public.assign_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
  tries int := 0;
begin
  if exists (select 1 from public.referral_codes where organization_id = new.id) then
    return new;
  end if;
  loop
    tries := tries + 1;
    candidate := public.generate_referral_code();
    begin
      insert into public.referral_codes (organization_id, code)
      values (new.id, candidate);
      return new;
    exception when unique_violation then
      if tries > 10 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.generate_referral_code() from public, anon, authenticated;
revoke all on function public.assign_referral_code() from public, anon, authenticated;

drop trigger if exists organizations_assign_referral_code on public.organizations;
create trigger organizations_assign_referral_code
  after insert on public.organizations
  for each row execute function public.assign_referral_code();

drop trigger if exists referral_signups_updated_at on public.referral_signups;
create trigger referral_signups_updated_at
  before update on public.referral_signups
  for each row execute function public.update_updated_at_column();

do $$
declare
  org record;
  candidate text;
  tries int;
begin
  for org in
    select o.id
    from public.organizations o
    where not exists (
      select 1 from public.referral_codes c where c.organization_id = o.id
    )
  loop
    tries := 0;
    loop
      tries := tries + 1;
      candidate := public.generate_referral_code();
      begin
        insert into public.referral_codes (organization_id, code)
        values (org.id, candidate);
        exit;
      exception when unique_violation then
        if tries > 10 then
          raise;
        end if;
      end;
    end loop;
  end loop;
end $$;
