import { createClient } from '@supabase/supabase-js'

// Same Supabase project as Putt Night. Putts & Pints only touches `pp_` tables.
// The anon key is public by design; Row Level Security limits writes to admins.
const url = 'https://smawnhsfntekjvtvnrwg.supabase.co'
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtYXduaHNmbnRla2p2dHZucndnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzEzMjIsImV4cCI6MjA5MjkwNzMyMn0.gFnqoa01NPv72fc4K4-7TLcVNd2JGFWkwwSYby5l6K8'

export const supabase = createClient(url, anonKey, {
  auth: { storageKey: 'putts-and-pints-auth' },
})
