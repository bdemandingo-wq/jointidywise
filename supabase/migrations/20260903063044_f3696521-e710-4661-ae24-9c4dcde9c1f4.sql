do $$
declare k text; u text; inv uuid;
begin
  insert into public.invoices (organization_id, customer_id, total_amount, subtotal, status, paid_at, notes)
  values ('0ddb3567-4641-48c8-8ff7-4bf1b87681da','4a90460a-92a8-469e-bf9d-6fac63c7484b',1.00,1.00,'paid',now(),'ZZTEMP-VERIFY')
  returning id into inv;

  select decrypted_secret into k from vault.decrypted_secrets where name='email_queue_service_role_key';
  select decrypted_secret into u from vault.decrypted_secrets where name='supabase_url';
  perform net.http_post(url:=u||'/functions/v1/notify-invoice-paid',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body:=jsonb_build_object('invoice_id',inv,'organization_id','0ddb3567-4641-48c8-8ff7-4bf1b87681da'),
    timeout_milliseconds:=55000);
end $$;