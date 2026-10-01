import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import webpush from "npm:web-push@3.6.7";
const secret = Deno.env.get("REMINDER_CRON_SECRET");
Deno.serve(async (request) => {
  if (
    request.method !== "POST" ||
    !secret ||
    request.headers.get("x-cron-secret") !== secret
  )
    return new Response("Unauthorized", { status: 401 });
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY"),
    privateKey = Deno.env.get("VAPID_PRIVATE_KEY"),
    subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject)
    return new Response("Missing server configuration", { status: 503 });
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: jobs, error } = await client.rpc("claim_reminders");
  if (error) return new Response("Unable to claim reminders", { status: 500 });
  for (const job of jobs) {
    const expired: string[] = [];
    let sent = false;
    for (const subscription of job.subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
          },
          JSON.stringify({
            title: "Arabic Revision Time 📚",
            body:
              job.due > 0
                ? job.due + " words are ready for review."
                : "Your daily Arabic quiz is ready.",
          }),
          { TTL: 1800, timeout: 10000 },
        );
        sent = true;
      } catch (e) {
        if (
          e &&
          typeof e === "object" &&
          "statusCode" in e &&
          (e.statusCode === 404 || e.statusCode === 410)
        )
          expired.push(subscription.id);
      }
    }
    await client.rpc("finish_reminder", {
      p_user: job.user_id,
      p_date: job.date,
      p_slot: job.slot,
      p_sent: sent,
      p_expired: expired,
    });
  }
  return Response.json({ processed: jobs.length });
});
