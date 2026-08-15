/**
 * Cliente unico de Supabase para todo el sitio.
 *
 * Estaba adentro de admin.js, pero desde la fase 5 el plano publico tambien lo
 * necesita —para el canal de tiempo real— y dos createClient en la misma pagina
 * abren dos websockets contra el mismo proyecto.
 *
 * La anon key es publica por diseno: con las politicas de db/politicas.sql solo
 * puede leer niveles y plazas. La service_role NUNCA va en esta carpeta: vive en
 * api/.env y solo la usa el backend.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://wudfiaqlltjrfasiwnnp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZGZpYXFsbHRqcmZhc2l3bm5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1Mzk2NDQsImV4cCI6MjEwMjExNTY0NH0.01tG1S7mVEOM1Ans1c6F0QVCrI1t8dpaVK6pOO0kTzE';

// Quien quiera enterarse de los latidos. Se guarda aca porque heartbeatCallback
// se fija al construir el cliente y no se puede cambiar despues, pero el que lo
// necesita es api.js.
let alLatir = () => {};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    // Por defecto son 25 segundos, y ese es exactamente el tiempo que el
    // indicador puede quedar mintiendo cuando la conexion muere en silencio.
    // A 10 segundos el costo es un mensaje diminuto cada 10 segundos.
    heartbeatIntervalMs: 10000,
    heartbeatCallback: (estado) => alLatir(estado)
  }
});

/** El canal manda un latido cada tantos segundos y avisa aca si le contestaron.
 *  Es la unica senal que distingue "no cambio nada" de "se murio la conexion". */
export function observarLatido(callback) {
  alLatir = callback;
}
