// Protege los endpoints que usan los dispositivos: el puente serie que reporta
// lo que mide el sensor de una plaza, y el servicio de lectura de matriculas.
// El dispositivo manda su token en el header:  Authorization: Bearer <token>
// Lo comparamos (hasheado) contra dispositivos.token_hash y confirmamos que
// tenga permiso para reportar sobre la plaza que menciona en el body.
//
// El alcance depende del tipo de dispositivo, y no es un detalle:
//
//   - 'gateway'  -> el puente. Cubre TODAS las plazas de su estacionamiento,
//                   asi que su plaza_id es null y lo que se valida es que la
//                   plaza reportada pertenezca a ese estacionamiento.
//   - el resto   -> esta atado a una plaza y solo puede reportar sobre esa.
//
// Sin la rama del gateway, un puente que cubre varias plazas recibiria 403 en
// todas: su plaza_id es null y nunca coincide con ninguna. Ver README 2.1.1.
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

  const plazaId = Number(req.body?.plaza_id);

  // Sin plaza_id no hay nada que validar aca: es la ruta la que responde 400
  // por el campo faltante, y ese mensaje es mas util que un 403.
  if (Number.isInteger(plazaId)) {
    if (dispositivo.tipo === 'gateway') {
      // La plaza no guarda el estacionamiento: lo hereda de su nivel.
      const { data: plaza, error: errorPlaza } = await supabase
        .from('plazas')
        .select('id, niveles(estacionamiento_id)')
        .eq('id', plazaId)
        .maybeSingle();

      if (errorPlaza) return next(errorPlaza);
      if (!plaza) return res.status(404).json({ error: 'Plaza no encontrada' });

      if (plaza.niveles?.estacionamiento_id !== dispositivo.estacionamiento_id) {
        return res
          .status(403)
          .json({ error: 'Ese puente no cubre el estacionamiento de esa plaza' });
      }
    } else if (plazaId !== dispositivo.plaza_id) {
      return res.status(403).json({ error: 'Este dispositivo no esta autorizado para esa plaza' });
    }
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
