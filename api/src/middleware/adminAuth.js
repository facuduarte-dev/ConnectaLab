// Protege los endpoints de administracion (panel para el operador del
// parking). El frontend, despues de que el usuario inicia sesion con
// Supabase Auth, manda su JWT en:  Authorization: Bearer <access_token>
// Este middleware valida ese token contra Supabase.
//
// NOTA para el equipo: esto es un punto de partida funcional. Si mas
// adelante quieren roles distintos (ej. "solo el dueño puede dar de baja
// vehiculos"), es el lugar donde agregar esa logica, leyendo
// user.user_metadata o una tabla propia de roles.
import { supabase } from '../lib/supabase.js';

export async function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Falta el header Authorization: Bearer <access_token>' });
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Sesion invalida o vencida' });
  }

  req.user = data.user;
  next();
}
