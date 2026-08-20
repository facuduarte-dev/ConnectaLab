import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import { adminAuth } from '../middleware/adminAuth.js';

export const eventosRouter = Router();

// POST /api/eventos
// Dispositivo (sensor). Body: { plaza_id, estado, fuente, confianza }
// Ver seccion 4.3/4.4 del README: el sensor mueve "estado"; la autorizacion
// de una plaza de discapacidad pasa a "pendiente" cuando se ocupa, y a
// "no_aplica" cuando se libera. El cliente nunca escribe "plazas" directo:
// esta ruta es la unica que lo hace, a partir de un evento.
eventosRouter.post('/', deviceAuth, async (req, res, next) => {
  try {
    const { plaza_id, estado, fuente, confianza } = req.body;

    if (!plaza_id || !estado || !fuente) {
      return res.status(400).json({ error: 'Faltan campos: plaza_id, estado, fuente' });
    }

    // 1. Se guarda el evento tal cual llego (es el historial crudo).
    const { error: errorEvento } = await supabase
      .from('eventos')
      .insert({ plaza_id, estado, fuente, confianza: confianza ?? 1.0 });

    if (errorEvento) throw errorEvento;

    // 2. Buscamos el tipo de la plaza para saber si aplica autorizacion.
    const { data: plaza, error: errorPlaza } = await supabase
      .from('plazas')
      .select('tipo')
      .eq('id', plaza_id)
      .maybeSingle();

    if (errorPlaza) throw errorPlaza;
    if (!plaza) return res.status(404).json({ error: 'Plaza no encontrada' });

    const cambios = { estado, actualizado_en: new Date().toISOString() };

    if (plaza.tipo === 'discapacidad') {
      cambios.autorizacion = estado === 'ocupado' ? 'pendiente' : 'no_aplica';
    }

    // 3. Actualizamos el estado (y autorizacion, si corresponde) de la plaza.
    const { data: plazaActualizada, error: errorUpdate } = await supabase
      .from('plazas')
      .update(cambios)
      .eq('id', plaza_id)
      .select()
      .maybeSingle();

    if (errorUpdate) throw errorUpdate;

    res.status(201).json(plazaActualizada);
  } catch (err) {
    next(err);
  }
});

// GET /api/eventos?plaza_id=&desde=&hasta=
// Administracion. Historial de ocupacion de una plaza.
eventosRouter.get('/', adminAuth, async (req, res, next) => {
  try {
    const { plaza_id, desde, hasta } = req.query;

    let query = supabase.from('eventos').select('*').order('creado_en', { ascending: false });

    if (plaza_id) query = query.eq('plaza_id', plaza_id);
    if (desde) query = query.gte('creado_en', desde);
    if (hasta) query = query.lte('creado_en', hasta);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    next(err);
  }
});
