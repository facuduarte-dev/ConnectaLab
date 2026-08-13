import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

// Fallar acá y no en la primera consulta: un 500 suelto a las tres semanas
// es mucho mas dificil de diagnosticar que un arranque que no arranca.
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en api/.env');
}

export const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});