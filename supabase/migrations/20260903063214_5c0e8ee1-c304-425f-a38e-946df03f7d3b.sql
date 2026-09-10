do $$
declare k text; u text;
begin
  update public.customers set marketing_status='opted_out' where id='505e9420-8b36-42aa-9f8e-d0a5b5be8bd1';
  select decrypted_secret into k from vault.decrypted_secrets where name='email_queue_service_role_key';
  select decrypted_secret into u from vault.decrypted_secrets where name='supabase_url';
  perform net.http_post(url:=u||'/functions/v1/send-loyalty-progress-email',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body:=jsonb_build_object('customerEmail','support@cleancollectives.com','customerName','ZZ Optin','pointsEarned',10,'totalPoints',10,'lifetimePoints',10,'currentTier','bronze','nextTier','silver','pointsToNextTier',90,'bookingNumber','TEST-A2-OPTOUT','organizationId','0ddb3567-4641-48c8-8ff7-4bf1b87681da'),
    timeout_milliseconds:=55000);
  perform net.http_post(url:=u||'/functions/v1/send-help-center-email',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body:=jsonb_build_object('type','support','name','ZZ Verify','email','support@cleancollectives.com','message','ZZTEMP transactional verification','organization_id','0ddb3567-4641-48c8-8ff7-4bf1b87681da'),
    timeout_milliseconds:=55000);
end $$;