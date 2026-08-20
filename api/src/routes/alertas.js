import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { adminAuth } from '../middleware/adminAuth.js';

export const alertasRouter = Router();

// GET /api/alertas
// Administracion. Bandeja de alertas pendientes de revision.
alertasRouter.get('/', adminAuth, async (req, res, next) => {
  try {
    const soloPendientes = req.query.revisada === undefined;

    let query = supabase.from('alertas').select('*').order('creado_en', { ascending: false });
    if (soloPendientes) query = query.eq('revisada', false);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/alertas/:id
// Administracion. Marca una alerta como revisada por una persona.
// El sistema nunca la marca solo: siempre hay un usuario detras (req.user).
alertasRouter.patch('/:id', adminAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('alertas')
      .update({
        revisada: true,
        revisada_por: req.user.id,
        revisada_en: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Alerta no encontrada' });

    res.json(data);
  } catch (err) {
    next(err);
  }
});
