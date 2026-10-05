// Explicitly approved disposable learners for existing feature regressions.
// Installed only in test databases; production signup remains pending.
export async function approveFixtureUsers(db){
 await db.exec(`create function app_private.test_approve_learner()returns trigger language plpgsql security definer as $$begin update public.app_memberships set status='approved'where user_id=new.id;return new;end$$;create trigger zz_test_approval after insert on auth.users for each row execute function app_private.test_approve_learner();`);
}
