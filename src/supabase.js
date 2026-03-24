import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://kaqlyacityjyuhhfjdkw.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthcWx5YWNpdHlqeXVoaGZqZGt3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMjI2MDcsImV4cCI6MjA4OTg5ODYwN30.YbDnQnZ-XFV1DMqGCRsdHyFinFRVT72daL6M0PGVgS4'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
