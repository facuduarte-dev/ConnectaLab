import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { adminAuth } from '../middleware/adminAuth.js';

export const plazasRouter = Router();

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
// El cliente nunca deberia escribir "plazas" directo salvo por esta via.
plazasRouter.patch('/:id', adminAuth, async (req, res, next) => {
  try {
    const { estado, autorizacion } = req.body;
    const cambios = { actualizado_en: new Date().toISOString() };

    if (estado) cambios.estado = estado;
    if (autorizacion) cambios.autorizacion = autorizacion;

    if (!estado && !autorizacion) {
      return res.status(400).json({ error: 'Mandá al menos "estado" o "autorizacion" para cambiar' });
    }

    const { data, error } = await supabase
      .from('plazas')
      .update(cambios)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plaza no encontrada' });

    res.json(data);
  } catch (err) {
    next(err);
  }
});
