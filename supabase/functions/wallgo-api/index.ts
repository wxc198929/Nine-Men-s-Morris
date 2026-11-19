import {createClient} from 'npm:@supabase/supabase-js@2.119.1';
import {createHandler} from './handler.js';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
// Anonymous leaderboard is public; every other command verifies the user through Auth.getUser.
Deno.serve(createHandler(admin));
