// Protege los endpoints que usan el ESP32 (sensores) y el servicio de camara.
// El dispositivo manda su token en el header:  Authorization: Bearer <token>
// Lo comparamos (hasheado) contra dispositivos.token_hash y confirmamos que
// tenga permiso para reportar sobre la plaza que menciona en el body.
import { supabase } from '../lib/supabase.js';
import { sha256 } from '../lib/hash.js';

export async function deviceAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Falta el header Authorization: Bearer <token>' });
  }

  const tokenHash = sha256(token);

  const { data: dispositivo, error } = await supabase
    .from('dispositivos')
    .select('id, estacionamiento_id, plaza_id, tipo, activo')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) return next(error);
  if (!dispositivo || !dispositivo.activo) {
    return res.status(401).json({ error: 'Token de dispositivo invalido o inactivo' });
  }

  // El dispositivo solo puede reportar sobre la plaza a la que esta asignado.
  const plazaId = Number(req.body?.plaza_id);
  if (plazaId && plazaId !== dispositivo.plaza_id) {
    return res.status(403).json({ error: 'Este dispositivo no esta autorizado para esa plaza' });
  }

  // Actualizamos el ultimo ping, sin bloquear la respuesta si falla.
  supabase
    .from('dispositivos')
    .update({ ultimo_ping: new Date().toISOString() })
    .eq('id', dispositivo.id)
    .then(() => {});

  req.dispositivo = dispositivo;
  next();
}
