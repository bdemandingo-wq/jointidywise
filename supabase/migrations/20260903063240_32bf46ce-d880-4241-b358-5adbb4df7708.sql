do $$
declare k text; u text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name='email_queue_service_role_key';
  select decrypted_secret into u from vault.decrypted_secrets where name='supabase_url';
  perform net.http_post(url:=u||'/functions/v1/send-help-center-email',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body:=jsonb_build_object('type','contact','name','ZZ Verify','email','support@cleancollectives.com','message','ZZTEMP transactional verification','organization_id','0ddb3567-4641-48c8-8ff7-4bf1b87681da'),
    timeout_milliseconds:=55000);
end $$;