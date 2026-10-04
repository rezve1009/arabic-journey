import { getAccount, loadAccount } from "./supabase.js";
import {
  vocabularyRequest,
  writeVocabulary,
  listWords,
  getWord,
  listTags,
} from "./vocabulary-data.js";
import { getCache, cachedAccount, atomic } from "./storage.js";
import { pendingOperations, refreshCache } from "./sync.js";
import {
  node,
  content,
  action,
  field,
  shell,
  ready,
  finish,
  message,
} from "./learning-ui.js";
import { normalizeArabic, parseRoot, parseArabicList } from "./arabic-utils.js";
export const demoVocabularyCsv="﻿\"arabic\",\"bangla\",\"english\",\"type\",\"root\",\"masdar\",\"tag\"\r\n\"كَتَبَ\",\"সে লিখেছে\",\"he wrote\",\"verb\",\"ك ت ب\",\"كِتَابَةٌ\",\"প্রাথমিক শব্দ\"\r\n\"كِتَابٌ\",\"বই\",\"book\",\"noun\",\"ك ت ب\",\"\",\"প্রাথমিক শব্দ\"\r\n\"جَمِيلٌ\",\"সুন্দর\",\"beautiful\",\"adjective\",\"\",\"\",\"প্রাথমিক শব্দ\"";
export function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function parseCsv(text, separator = ",") {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === separator && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function validateBackup(data) {
  if (data?.format !== "arabic-journey" || data.version !== 1)
    throw new Error("Unsupported backup version");
  for (const table of [
    "words",
    "tags",
    "word_tags",
    "word_review_state",
    "review_history",
    "quiz_sessions",
    "quiz_answers",
    "study_sessions",
  ])
    if (!Array.isArray(data[table]) || data[table].length > 100000)
      throw new Error("Invalid backup table");
  if (
    !data.settings ||
    data.words.some(
      (w) => !w.id || !w.arabic_word || !w.bangla_meaning || !w.english_meaning,
    )
  )
    throw new Error("Invalid vocabulary");
  if (data.pending_operations?.length)
    throw new Error(
      "This backup includes unsynced changes. Sync them before restoring.",
    );
  return data;
}
export function download(name, value, type) {
  const url = URL.createObjectURL(new Blob([value], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function fullBackup() {
  if (navigator.onLine) return vocabularyRequest((c) => c.rpc("backup_export"));
  const uid = getAccount().user.id,
    cached = await cachedAccount(uid),
    data = {
      format: "arabic-journey",
      version: 1,
      exported_at: new Date().toISOString(),
      settings: cached.settings,
      profile: cached.profile,
      pending_operations: await pendingOperations(),
    };
  for (const table of [
    "words",
    "tags",
    "word_tags",
    "word_review_state",
    "review_history",
    "quiz_sessions",
    "quiz_answers",
    "study_sessions",
  ])
    data[table] = await getCache(uid, table);
  return data;
}
export function backupPage() {
  const page = shell("Import / Export");
  if (!ready(page)) return finish(page);
  const exports = node("section", "", "card study-card");
  exports.append(
    node("h2", "Backup"),
    action("Download full JSON backup", async () => {
      try {
        download(
          "arabic-journey-backup.json",
          JSON.stringify(await fullBackup(), null, 2),
          "application/json",
        );
      } catch (e) {
        message(exports, e);
      }
    }),
    action("Vocabulary CSV", async () => {
      try {
        const data = await fullBackup(),
          columns = [
            "arabic_word",
            "bangla_meaning",
            "english_meaning",
            "word_type",
            "root",
            "masdars",
            "notes",
          ];
        download(
          "arabic-vocabulary.csv",
          "\ufeff" +
            [
              columns,
              ...data.words
                .filter((w) => !w.deleted_at)
                .map((w) =>
                  columns.map((k) =>
                    Array.isArray(w[k])
                      ? w[k].join(k === "masdars" ? "\n" : " ")
                      : w[k],
                  ),
                ),
            ]
              .map((r) => r.map(csvCell).join(","))
              .join("\r\n"),
          "text/csv;charset=utf-8",
        );
      } catch (e) {
        message(exports, e);
      }
    }),
    action("Review History CSV", async () => {
      try {
        const data = await fullBackup(),
          columns = [
            "occurred_at",
            "word_id",
            "rating",
            "prior_interval",
            "new_interval",
            "next_review_at",
          ];
        download(
          "arabic-review-history.csv",
          "\ufeff" +
            [
              columns,
              ...data.review_history.map((e) => columns.map((k) => e[k])),
            ]
              .map((r) => r.map(csvCell).join(","))
              .join("\r\n"),
          "text/csv;charset=utf-8",
        );
      } catch (e) {
        message(exports, e);
      }
    }),
  );
  page.append(exports);
  const imports = node("section", "", "card study-card");
  imports.append(node("h2", "Import vocabulary or restore backup"),node("p","Download the sample, replace its three sample rows with your words, then choose the file and preview the import.","settings-help"),action("Download demo CSV",()=>download("arabic-journey-demo.csv",demoVocabularyCsv,"text/csv;charset=utf-8")),node("p","Column order: Arabic, Bengali, English, type, root, masdar, tag. The first three columns are required. Keep the header row and save as UTF-8 CSV.","settings-help"));
  const file = field("JSON or CSV file", "file");
  file.input.accept = ".json,.csv";
  const paste = node("textarea");
  paste.setAttribute("aria-label", "Bulk vocabulary rows");
  paste.placeholder = "Arabic\tBengali\tEnglish\tType\tRoot\tMasdar\tTag";
  imports.append(
    file.wrap,
    node(
      "p",
      "Paste spreadsheet rows: Arabic, Bengali, English, Type, Root, Masdar, Tag.",
    ),
    paste,
  );
  let restoreOp = crypto.randomUUID();
  const preview = node("div");
  imports.append(
    action("Preview import", async () => {
      preview.replaceChildren();
      try {
        let data;
        if (file.input.files[0]) {
          if (file.input.files[0].size > 20971520)
            throw new Error("File too large");
          const text = await file.input.files[0].text();
          if (file.input.files[0].name.endsWith(".json")) {
            data = validateBackup(JSON.parse(text));
            preview.append(
              content(
                "p",
                data.words.length +
                  " words · " +
                  data.review_history.length +
                  " reviews · " +
                  data.quiz_answers.length +
                  " quiz answers",
              ),
              node(
                "p",
                "Restore replaces your current vocabulary and learning history. Download a backup first.",
              ),
              node(
                "p",
                "For safety, restore needs an internet connection and an empty sync queue.",
              ),
            );
            const confirmation = field("Type RESTORE to replace your data");
            preview.append(
              confirmation.wrap,
              action(
                "Restore backup",
                async () => {
                  if (confirmation.input.value !== "RESTORE") return;
                  try {
                    if (!navigator.onLine || (await pendingOperations()).length)
                      throw new Error("Sync pending changes first");
                    download(
                      "arabic-journey-before-restore.json",
                      JSON.stringify(await fullBackup()),
                      "application/json",
                    );
                    await vocabularyRequest((c) =>
                      c.rpc("backup_restore", {
                        p_operation: restoreOp,
                        p_backup: data,
                        p_confirmation: "RESTORE",
                      }),
                    );
                    await atomic(["meta"], (tx) =>
                      tx
                        .objectStore("meta")
                        .delete(getAccount().user.id + ":active-quiz"),
                    );
                    window.dispatchEvent(new Event("learningreset"));
                    await loadAccount();
                    await refreshCache();
                    preview.replaceChildren(node("p", "Backup restored."));
                  } catch (e) {
                    message(preview, e);
                  }
                },
                true,
              ),
            );
            finish(page);
            return;
          }
          data = parseCsv(text.replace(/^\ufeff/, ""));
        } else data = parseCsv(paste.value, "\t");
        let header = null;
        if (
          data[0] &&
          ["arabic", "arabic_word"].includes(data[0][0].toLowerCase())
        )
          header = data.shift().map((h) => h.toLowerCase());
        if (data.length > 1000)
          throw new Error("Import up to 1000 rows at a time");
        const existing = [];
        for (let p = 0; ; p++) {
          const r = await listWords({ page: p });
          existing.push(...r.words);
          if ((p + 1) * 25 >= r.total) break;
        }
        const rows = data.map((r, i) => {
          try {
            if (!r[0]?.trim() || !r[1]?.trim() || !r[2]?.trim())
              throw new Error("Required meanings");
            const values = {
              arabic_word: r[0],
              bangla_meaning: r[1],
              english_meaning: r[2],
              word_type: r[3]?.trim() || "other",
              root: parseRoot(r[4] || ""),
              masdars: parseArabicList(r[5] || ""),
              notes: header?.includes("notes")
                ? r[header.indexOf("notes")] || ""
                : "",
              needs_details: true,
            };
            if (
              ![
                "verb",
                "noun",
                "adjective",
                "particle",
                "phrase",
                "other",
              ].includes(values.word_type)
            )
              throw new Error("Invalid type");
            return {
              values,
              tag: header?.includes("notes") ? null : r[6]?.trim(),
              matches: existing.filter(
                (w) => normalizeArabic(w.arabic_word) === normalizeArabic(r[0]),
              ),
              id: crypto.randomUUID(),
              op: crypto.randomUUID(),
              row: i + 1,
            };
          } catch (e) {
            return { invalid: e.message, row: i + 1 };
          }
        });
        const valid = rows.filter((r) => !r.invalid);
        preview.append(
          content(
            "p",
            rows.length +
              " total · " +
              valid.filter((r) => !r.matches.length).length +
              " new · " +
              valid.filter((r) => r.matches.length).length +
              " possible duplicates · " +
              (rows.length - valid.length) +
              " invalid",
          ),
        );
        for (const r of rows.filter((r) => r.invalid))
          preview.append(content("p", "Row " + r.row + ": " + r.invalid));
        const policy = node("select");
        policy.setAttribute("aria-label", "Duplicate policy");
        for (const [v, label] of [
          ["skip", "Skip duplicates"],
          ["update", "Update matching"],
          ["anyway", "Import anyway"],
        ])
          policy.append(Object.assign(node("option", label), { value: v }));
        preview.append(
          policy,
          action(
            "Import valid rows",
            async () => {
              let imported = 0;
              try {
                const tags = await listTags();
                for (const row of valid) {
                  if (
                    row.saved ||
                    (policy.value === "skip" && row.matches.length)
                  )
                    continue;
                  if (
                    policy.value === "update" &&
                    row.matches.length !== 1 &&
                    row.matches.length
                  )
                    throw new Error(
                      "Multiple matching words; choose skip or import anyway",
                    );
                  let tagIds = [];
                  if (row.tag) {
                    let tag = tags.find((t) => t.name === row.tag);
                    if (!tag) {
                      const id = crypto.randomUUID();
                      const r = await writeVocabulary({
                        action: "tag-save",
                        id,
                        values: { name: row.tag, kind: "tag" },
                      });
                      tag = r.tag;
                      tags.push(tag);
                    }
                    tagIds = [tag.id];
                  }
                  const match =
                    policy.value === "update" ? row.matches[0] : null;
                  const full = match ? await getWord(match.id) : null;
                  const result = await writeVocabulary({
                    operation: row.op,
                    action: "save",
                    id: match?.id || row.id,
                    revision: full?.revision || null,
                    values: { ...row.values },
                    tags: tagIds,
                    allowDuplicate: policy.value === "anyway" || !!match,
                  });
                  if (result.duplicates)
                    throw new Error("New duplicate detected; preview again");
                  row.saved = true;
                  imported++;
                }
                preview.append(content("p", imported + " words imported."));
              } catch (e) {
                message(preview, e);
              }
            },
            true,
          ),
        );
        finish(page);
      } catch (e) {
        message(preview, e);
      }
    }),
    preview,
  );
  page.append(imports);
  return finish(page);
}
