do $$
declare k text; u text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name='email_queue_service_role_key';
  select decrypted_secret into u from vault.decrypted_secrets where name='supabase_url';
  perform net.http_post(url:=u||'/functions/v1/send-loyalty-progress-email',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body:=jsonb_build_object('customerEmail','marketing-optout-test@cleancollectives.com','customerName','ZZ Optout','pointsEarned',10,'totalPoints',10,'lifetimePoints',10,'currentTier','bronze','nextTier','silver','pointsToNextTier',90,'bookingNumber','TEST-A-OPTOUT','organizationId','0ddb3567-4641-48c8-8ff7-4bf1b87681da'),
    timeout_milliseconds:=55000);
  perform net.http_post(url:=u||'/functions/v1/send-loyalty-progress-email',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body:=jsonb_build_object('customerEmail','support@cleancollectives.com','customerName','ZZ Optin','pointsEarned',10,'totalPoints',10,'lifetimePoints',10,'currentTier','bronze','nextTier','silver','pointsToNextTier',90,'bookingNumber','TEST-A-OPTIN','organizationId','0ddb3567-4641-48c8-8ff7-4bf1b87681da'),
    timeout_milliseconds:=55000);
  perform net.http_post(url:=u||'/functions/v1/send-loyalty-progress-email',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||k),
    body:=jsonb_build_object('customerEmail','marketing-optout-test@cleancollectives.com','customerName','ZZ OrgB','pointsEarned',10,'totalPoints',10,'lifetimePoints',10,'currentTier','bronze','nextTier','silver','pointsToNextTier',90,'bookingNumber','TEST-B-CROSSORG','organizationId','1225e1b5-6672-4967-aee4-709fd98b0d57'),
    timeout_milliseconds:=55000);
end $$;