// Un unico cliente de Supabase, reusado por todas las rutas.
// Usa la SECRET KEY: este codigo corre solo en el backend, nunca en el navegador,
// asi que puede saltarse Row Level Security a proposito (lo necesita, por
// ejemplo, para escribir en "lecturas" y leer "alertas", que el frontend con la
// publishable key no puede tocar).
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    'Falta SUPABASE_URL o SUPABASE_SECRET_KEY. Revisa que exista api/.env ' +
    '(copiado de .env.example) con los valores reales de tu proyecto.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
