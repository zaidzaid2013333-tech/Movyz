import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) throw new Error('Missing Supabase server environment variables');

export const createUserClient = (token:string):SupabaseClient =>
  createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});

export const adminSupabase = createClient(url,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
