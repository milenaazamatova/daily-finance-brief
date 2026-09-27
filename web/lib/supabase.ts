import { createClient } from "@supabase/supabase-js";

// The website only ever uses the PUBLIC anon key. What it can read is decided by the database's
// grants + Row Level Security, not by this code. The service-role key must never be used here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function assertPublicKey(key: string) {
  // New-style Supabase keys: sb_publishable_... is fine, sb_secret_... bypasses RLS.
  if (key.startsWith("sb_secret_")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is a SECRET key. Use the anon/publishable key.");
  }
  // Legacy keys are JWTs whose payload says which role they act as.
  if (key.startsWith("eyJ")) {
    const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    if (payload.role !== "anon") {
      throw new Error(`NEXT_PUBLIC_SUPABASE_ANON_KEY has role "${payload.role}". Use the anon key.`);
    }
  }
}

export function getSupabase() {
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  assertPublicKey(anonKey);
  return createClient(url, anonKey, { auth: { persistSession: false } });
}
