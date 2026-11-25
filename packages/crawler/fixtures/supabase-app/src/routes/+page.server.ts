import { supabase } from '$lib/db';
export async function load() { const { data } = await supabase.from('posts').select('*').order('id'); return { posts: data }; }
