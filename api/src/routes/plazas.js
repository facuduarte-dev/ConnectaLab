import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { adminAuth } from '../middleware/adminAuth.js';

export const plazasRouter = Router();

const ESTADOS = ['libre', 'ocupado', 'reservado', 'sin_datos'];
const AUTORIZACIONES = [
  'no_aplica',
  'pendiente',
  'autorizado',
  'no_autorizado',
  'no_verificable',
];

// GET /api/plazas?nivel_id=1
// Publico. Plazas de un nivel, con su posicion en el plano y estado actual.
plazasRouter.get('/', async (req, res, next) => {
  try {
    const nivelId = Number(req.query.nivel_id);
    let query = supabase
      .from('plazas')
      .select('id, nivel_id, codigo, x, y, ancho, alto, tipo, estado, autorizacion, actualizado_en');

    if (nivelId) query = query.eq('nivel_id', nivelId);

    const { data, error } = await query.order('codigo', { ascending: true });
    if (error) throw error;

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/plazas/:id
// Publico. Detalle de una plaza puntual.
plazasRouter.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('plazas')
      .select('id, nivel_id, codigo, x, y, ancho, alto, tipo, estado, autorizacion, actualizado_en')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plaza no encontrada' });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/plazas/:id
// Administracion. Cambio manual de estado (ej: el operador marca una plaza
// como fuera de servicio, o corrige un error del sensor a mano).
//
// El cambio de estado NO se escribe directo sobre "plazas": pasa por
// registrar_evento(), que inserta la fila en "eventos" y actualiza la plaza en
// una sola transaccion. Es la regla del README 4.4 —el backend escribe el
// evento y despues actualiza el estado— y es lo que mantiene el historial
// completo: una correccion manual del operador tiene que quedar registrada
// igual que una lectura del sensor.
//
// La autorizacion es distinta y por eso va aparte: no es un evento de
// ocupacion, es el resultado de la verificacion de la matricula (README 4.3).
// No entra en "eventos" y se aplica como un update propio.
plazasRouter.patch('/:id', adminAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { estado, autorizacion } = req.body;

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id tiene que ser un entero' });
    }

    if (!estado && !autorizacion) {
      return res
        .status(400)
        .json({ error: 'Mandá al menos "estado" o "autorizacion" para cambiar' });
    }

    // Validar contra la lista aca y no dejar que reviente el enum: sin esto un
    // estado mal escrito sale como 500 y parece un problema del servidor.
    if (estado && !ESTADOS.includes(estado)) {
      return res.status(400).json({
        error: `estado tiene que ser uno de: ${ESTADOS.join(', ')}`,
      });
    }

    if (autorizacion && !AUTORIZACIONES.includes(autorizacion)) {
      return res.status(400).json({
        error: `autorizacion tiene que ser una de: ${AUTORIZACIONES.join(', ')}`,
      });
    }

    let plaza = null;

    if (estado) {
      const { data, error } = await supabase.rpc('registrar_evento', {
        p_plaza_id: id,
        p_estado: estado,
        p_fuente: 'manual',
      });

      if (error) throw error;
      plaza = data;
    }

    // Va despues del estado a proposito: registrar_evento() recalcula la
    // autorizacion segun el estado nuevo, asi que un valor puesto a mano tiene
    // que aplicarse encima y no antes, o lo pisa.
    if (autorizacion) {
      const { data, error } = await supabase
        .from('plazas')
        .update({ autorizacion, actualizado_en: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;
      plaza = data;
    }

    if (!plaza) return res.status(404).json({ error: 'Plaza no encontrada' });

    res.json(plaza);
  } catch (err) {
    next(err);
  }
});
