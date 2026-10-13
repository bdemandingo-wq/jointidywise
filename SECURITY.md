# Security

## Reporting

If you discover a security issue, email **support@jointidywise.com**. Please don't open a public issue.

## Secrets policy

- Anything tagged `VITE_*` is bundled into the client. Treat it as **public**.
- Supabase anon (publishable) key is intentionally public; row-level security in the database is the actual access control.
- Anything sensitive (Stripe **secret**, service-role keys, OpenPhone keys, Lovable API key, Google Places key, OpenAI/AI gateway keys) lives **only** in Supabase Edge Function secrets — never in the repo, never in `VITE_*` vars.
- `.env` is `.gitignore`d. If you need example values for new contributors, put them in `.env.example` with placeholder strings only.

## Known historical leak — ROTATE if not already done

A Google Maps API key (`AIzaSyB...`) was hardcoded in
`src/components/ui/AddressAutocomplete.tsx` and committed to git history.
The file has since been removed, but the key remains in history forever.

**Required action**: rotate the affected key in the Google Cloud Console
and add domain referer restrictions to the replacement so it can only
be used from `*.jointidywise.com` and `*.tidywise.com`. If the key is
still active and unrestricted, every clone of this public repo is a
potential abuser of your Google Maps billing.

## Continuous scanning

This repo has a `.gitleaksignore` for known false positives. To scan locally:

```sh
brew install gitleaks
gitleaks detect --no-banner
```

If you discover a real new leak, rotate the secret first, *then* commit
the code change that removes it. The git history will still expose the
old value — only key rotation actually mitigates the exposure.
