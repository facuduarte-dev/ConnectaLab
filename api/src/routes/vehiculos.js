import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { adminAuth } from '../middleware/adminAuth.js';

export const vehiculosRouter = Router();

// POST /api/vehiculos
// Administracion. Alta de un vehiculo en el padron propio del parking.
// Body: { estacionamiento_id, matricula_hash, tipo_permiso, referencia?, vigente_hasta? }
// Importante: el que llama calcula el HMAC de la matricula ANTES de mandarlo
// aca (con el helper de "vision/" o donde viva ese calculo). Este endpoint
// nunca deberia recibir una matricula en texto plano.
vehiculosRouter.post('/', adminAuth, async (req, res, next) => {
  try {
    const { estacionamiento_id, matricula_hash, tipo_permiso, referencia, vigente_hasta } = req.body;

    if (!estacionamiento_id || !matricula_hash || !tipo_permiso) {
      return res.status(400).json({
        error: 'Faltan campos: estacionamiento_id, matricula_hash, tipo_permiso',
      });
    }

    const { data, error } = await supabase
      .from('vehiculos_autorizados')
      .insert({ estacionamiento_id, matricula_hash, tipo_permiso, referencia, vigente_hasta })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/vehiculos/:id
// Administracion. Baja de un vehiculo del padron.
// Se marca como inactivo en vez de borrar la fila, asi las lecturas viejas
// que referencian este vehiculo (lecturas.vehiculo_id) no quedan huerfanas.
vehiculosRouter.delete('/:id', adminAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('vehiculos_autorizados')
      .update({ activo: false })
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Vehiculo no encontrado' });

    res.json({ ok: true, vehiculo: data });
  } catch (err) {
    next(err);
  }
});
