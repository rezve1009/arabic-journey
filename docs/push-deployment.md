
# Push deployment

This project uses dedicated Supabase project xtjtpkklmabtookelhrz. Frontend hosting stays on GitHub Pages. Migrations 005–012 and the reminders Edge Function/Vault/cron were deployed on 2026-10-01. Keep stable generated credentials in ignored supabase/.env.push. Actual subscription/device delivery is still unverified. The procedure below documents setup and maintenance; do not replay already applied migrations.

1. Apply new SQL migrations 202610010005 through 202610010012, in order. Each transaction is additive and does not execute backup restore. Keep the old migration files unchanged. Existing SQL-Editor migrations may not be in Supabase CLI migration history: do not blindly run db push against that project.
2. Authenticate the official Supabase CLI on the owner's device. No access token, service-role key or private key should be pasted into chat.
3. Run node scripts/configure-push.mjs once. It creates ignored supabase/.env.push. Keep these keys stable and back them up privately. Do not commit that file.
4. Use supabase secrets set --env-file supabase/.env.push --project-ref xtjtpkklmabtookelhrz. Supabase injects its service-role environment only into the server function.
5. Deploy supabase/functions/reminders using supabase functions deploy reminders --project-ref xtjtpkklmabtookelhrz --no-verify-jwt. This dedicated cron endpoint performs its own mandatory x-cron-secret verification; it does not accept a browser JWT as authorization. Do not disable authentication on unrelated functions.
6. Put REMINDER_CRON_SECRET into Supabase Vault as arabic_journey_cron_secret. Configure a once-per-minute pg_cron job using pg_net HTTP POST to https://xtjtpkklmabtookelhrz.supabase.co/functions/v1/reminders with that Vault secret in the x-cron-secret header. Do not store the secret in raw cron SQL, logs or frontend config. The documented Supabase Vault scheduling pattern is linked below.
7. Insert the generated public VAPID key into public.push_configuration with id=true, enabled=true only after the server and cron are running. The private key stays in Edge Function secrets. Verify one real explicit subscription and one grouped delivery before claiming notifications are live.
8. Run npm run prepare:pwa, deploy the frontend, and validate install/offline/push on supported real devices. iOS requires a compatible installed Home Screen web app; delivery remains best effort.

References: [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [offline/background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation).
