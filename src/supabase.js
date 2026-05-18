import { createClient } from "@supabase/supabase-js";

// Load Supabase credentials from Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// Safely initialize to prevent crash when keys are missing (e.g. initial static deploy)
export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

if (!supabase) {
  console.warn(
    "Supabase credentials not found. Running in Local Storage Mode."
  );
}
