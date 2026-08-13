import { db } from '../db.js';

/**
 * Verifica el token de sesion que manda el panel y deja el usuario en
 * peticion.usuario para las rutas que vengan despues.
 */
export async function autenticarUsuario(peticion, respuesta, siguiente) {
  const cabecera = peticion.get('authorization') ?? '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;

  if (!token) {
    return respuesta.status(401).json({ error: 'Falta el token de sesion' });
  }

  // getUser le pregunta a Supabase si el token sigue vivo. Verificar la firma
  // aca seria mas rapido, pero obligaria a guardar el secreto JWT en el .env y
  // no se enteraria de una sesion cerrada antes de que venza.
  const { data, error } = await db.auth.getUser(token);

  if (error || !data?.user) {
    return respuesta.status(401).json({ error: 'Sesion invalida o vencida' });
  }

  peticion.usuario = data.user;
  siguiente();
}