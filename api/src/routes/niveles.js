import { Router } from 'express';
import { supabase } from '../lib/supabase.js';

export const nivelesRouter = Router();

// GET /api/niveles
// Publico. Devuelve los niveles con sus dimensiones de plano y cuantas
// plazas libres tiene cada uno (util para el selector de nivel del frontend).
nivelesRouter.get('/', async (req, res, next) => {
  try {
    const { data: niveles, error } = await supabase
      .from('niveles')
      .select('id, estacionamiento_id, nombre, orden, ancho_plano, alto_plano')
      .order('orden', { ascending: true });

    if (error) throw error;

    // Conteo de plazas libres por nivel, en una sola consulta extra.
    const { data: plazas, error: errorPlazas } = await supabase
      .from('plazas')
      .select('nivel_id, estado');

    if (errorPlazas) throw errorPlazas;

    const libresPorNivel = plazas.reduce((acc, p) => {
      if (p.estado === 'libre') acc[p.nivel_id] = (acc[p.nivel_id] || 0) + 1;
      return acc;
    }, {});

    const respuesta = niveles.map((n) => ({
      ...n,
      plazas_libres: libresPorNivel[n.id] || 0,
    }));

    res.json(respuesta);
  } catch (err) {
    next(err);
  }
});
