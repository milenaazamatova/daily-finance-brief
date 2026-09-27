// Security test: connects EXACTLY like the website (anon key only) and checks what it can and can't do.
// Run from the web folder:  npm run test:security
// Write attempts target rows that don't exist (e.g. id -1), so even if a permission were wrongly
// granted, nothing would change; the test would just report FAIL.
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in web/.env.local");

const role = key.startsWith("eyJ") ? JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role : key.split("_")[1];
const db = createClient(url, key, { auth: { persistSession: false } });

const results = [];
const DENIED = "42501"; // PostgreSQL "insufficient privilege"

async function expectAllowed(name, run) {
  const { data, error, count } = await run();
  const rows = count ?? data?.length ?? 0;
  results.push([error ? "FAIL" : "PASS", name, error ? `error: ${error.message}` : `allowed (${rows} rows)`]);
}

async function expectDenied(name, run) {
  const { error } = await run();
  const ok = error?.code === DENIED;
  results.push([ok ? "PASS" : "FAIL", name, error ? `blocked: ${error.message}` : "NOT blocked!"]);
}

// 1. The key itself must be the public anon key.
results.push([role === "anon" || role === "publishable" ? "PASS" : "FAIL", "Key role is anon (public)", `role = ${role}`]);

// 2. Public tables: reading must work.
for (const table of ["briefs", "stories", "story_entities", "story_sources", "glossary"]) {
  await expectAllowed(`Read ${table}`, () => db.from(table).select("*", { count: "exact", head: true }));
}

// 3. takes: private. No reading, no writing.
await expectDenied("Read takes", () => db.from("takes").select("*"));
await expectDenied("Insert into takes", () => db.from("takes").insert({ story_id: -1, take_text: "security test" }));
await expectDenied("Update takes", () => db.from("takes").update({ take_text: "x" }).eq("id", -1));
await expectDenied("Delete from takes", () => db.from("takes").delete().eq("id", -1));

// 4. Public tables are read-only for the website.
await expectDenied("Insert into stories", () => db.from("stories").insert({ brief_id: -1, headline: "x" }));
await expectDenied("Update stories", () => db.from("stories").update({ headline: "x" }).eq("id", -1));
await expectDenied("Delete from stories", () => db.from("stories").delete().eq("id", -1));
await expectDenied("Insert into glossary", () => db.from("glossary").insert({ term: "security test", explanation: "x" }));

// 5. articles: only link columns of cited articles.
await expectAllowed("Read article link columns", () =>
  db.from("articles").select("id, title, source, url, published_at", { count: "exact", head: true }),
);
await expectDenied("Read article excerpt (hidden column)", () => db.from("articles").select("excerpt").limit(1));
await expectDenied("Insert into articles", () => db.from("articles").insert({ title: "x", source: "x", url: "https://example.com/x" }));
{
  const visible = await db.from("articles").select("id");
  const cited = await db.from("story_sources").select("article_id");
  const citedIds = new Set(cited.data?.map((r) => r.article_id));
  const onlyCited = !visible.error && visible.data.every((a) => citedIds.has(a.id)) && visible.data.length === citedIds.size;
  results.push([onlyCited ? "PASS" : "FAIL", "Only articles cited by a story are visible",
    `${visible.data?.length ?? 0} visible, ${citedIds.size} cited`]);
}

console.log("\nSecurity test (anon key, exactly as the website connects)\n");
for (const [status, name, detail] of results) console.log(`${status === "PASS" ? "✓" : "✗"} ${status}  ${name.padEnd(44)} ${detail}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed${failed ? ` - ${failed} FAILED` : ""}\n`);
process.exit(failed ? 1 : 0);
