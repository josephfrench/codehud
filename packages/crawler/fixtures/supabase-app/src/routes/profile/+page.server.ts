import { supabase } from '$lib/db';
export const actions = { save: async () => { await supabase.from('profiles').update({ display_name: 'x' }).eq('id', '1'); await supabase.storage.from('avatars').upload('a.png', new Blob()); } };
