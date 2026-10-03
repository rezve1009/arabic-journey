import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
test("Learning migrations: eligible authored quiz, server scoring, retries and ownership", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;",
    );
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    const alice = randomUUID(),
      bob = randomUUID(),
      word = randomUUID();
    await db.query("insert into auth.users(id)values($1),($2)", [alice, bob]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      alice,
    ]);
    await db.query("select public.vocabulary_write($1,'save',$2,null,$3)", [
      randomUUID(),
      word,
      JSON.stringify({
        arabic_word: "كَتَبَ",
        bangla_meaning: "লিখেছে",
        english_meaning: "wrote",
        word_type: "verb",
        root: ["ك", "ت", "ب"],
        masdars: ["كِتَابَةٌ"],
        verb_form: 1,
      }),
    ]);
    const op = randomUUID();
    const start = async () =>
      (
        await db.query(
          "select public.quiz_start($1,10,array['root','masdar','conjugation','fill_blank']) result",
          [op],
        )
      ).rows[0].result;
    const quiz = await start();
    assert(quiz.questions.length >= 2);
    assert(quiz.questions.every((q) => ["root", "masdar"].includes(q.type)));
    assert.deepEqual(await start(), quiz);
    const answers = quiz.questions.map((q) => ({
        id: q.id,
        answer: q.answers[0],
        response_ms: 1500,
      })),
      finishOp = randomUUID();
    const finish = async () =>
      (
        await db.query("select public.quiz_finish($1,$2,$3) result", [
          finishOp,
          quiz.id,
          JSON.stringify(answers),
        ])
      ).rows[0].result;
    const result = await finish();
    assert.equal(result.score, quiz.questions.length);
    assert.deepEqual(await finish(), result);
    await assert.rejects(
      db.query("select public.quiz_finish($1,$2,$3)", [
        randomUUID(),
        quiz.id,
        JSON.stringify(answers),
      ]),
      /unavailable/,
    );
    const tagId = randomUUID();
    await db.query("select public.vocabulary_write($1,'tag-save',$2,null,$3)", [
      randomUUID(),
      tagId,
      JSON.stringify({ name: "Lesson 1", kind: "tag" }),
    ]);
    const originalState = (
      await db.query("select *from public.word_review_state")
    ).rows[0];
    const backup = (await db.query("select public.backup_export() result"))
      .rows[0].result;
    assert(backup.words.length === 1);
    const restoreOp = randomUUID();
    const restored = (
      await db.query("select public.backup_restore($1,$2,'RESTORE') result", [
        restoreOp,
        JSON.stringify(backup),
      ])
    ).rows[0].result;
    assert.equal(restored.restored, 1);
    assert.equal(
      (await db.query("select count(*)::int n from public.quiz_answers"))
        .rows[0].n,
      quiz.questions.length,
    );
    assert.equal(
      (await db.query("select *from public.tags")).rows[0].name,
      "Lesson 1",
    );
    const afterState = (await db.query("select *from public.word_review_state"))
      .rows[0];
    for (const key of [
      "stage",
      "interval_days",
      "review_count",
      "quiz_count",
      "quiz_correct",
      "weak_score",
      "mastery_status",
    ])
      assert.deepEqual(
        key === "mastery_status" ? afterState[key] : Number(afterState[key]),
        key === "mastery_status"
          ? originalState[key]
          : Number(originalState[key]),
      );
    const broken = structuredClone(backup);
    broken.words[0].bangla_meaning = null;
    await assert.rejects(
      db.query("select public.backup_restore($1,$2,'RESTORE')", [
        randomUUID(),
        JSON.stringify(broken),
      ]),
    );
    assert.equal(
      (await db.query("select *from public.words")).rows[0].bangla_meaning,
      "লিখেছে",
    );
    await assert.rejects(
      db.query("select public.claim_reminders()"),
      /permission/,
    );
    await assert.rejects(
      db.query("select public.sync_snapshot($1)", ["profiles"]),
      /Invalid/,
    );
    const stats = (await db.query("select public.learning_statistics() result"))
      .rows[0].result;
    assert.equal(stats.total, 1);
    assert.equal(stats.quiz_today, quiz.questions.length);
    assert.equal(
      (await db.query("select public.learning_history() result")).rows[0].result
        .total,
      quiz.questions.length,
    );
    assert.equal((await db.query("select public.activity_history() result")).rows[0].result.total,quiz.questions.length+1);
    assert.equal((await db.query("select public.activity_history(p_kind=>'word') result")).rows[0].result.total,1);
    assert.equal((await db.query("select public.activity_history(p_from=>'1900-01-01',p_to=>'1900-01-02') result")).rows[0].result.total,0);
    assert.equal((await db.query("select public.vocabulary_list(p_status=>'today') result")).rows[0].result.total,1);
    assert.equal((await db.query("select public.vocabulary_list(p_status=>'reviewing') result")).rows[0].result.total,stats.reviewing);
    assert.equal((await db.query("select public.vocabulary_list(p_status=>'learning') result")).rows[0].result.total,stats.learning);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob,
    ]);
    assert.equal((await db.query("select public.activity_history() result")).rows[0].result.total,0);
    assert.equal((await db.query("select public.vocabulary_list(p_status=>'today') result")).rows[0].result.total,0);

    assert.equal(
      (await db.query("select * from public.quiz_sessions")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select public.quiz_finish($1,$2,$3)", [
        randomUUID(),
        quiz.id,
        JSON.stringify(answers),
      ]),
      /unavailable/,
    );
  } catch (e) {
    console.error({
      message: e.message,
      where: e.where,
      internalQuery: e.internalQuery,
      position: e.position,
    });
    throw e;
  } finally {
    await db.close();
  }
});
