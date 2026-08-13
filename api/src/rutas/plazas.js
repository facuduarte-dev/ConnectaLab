import { Router } from 'express';
import { db } from '../db.js';

export const rutasPlazas = Router();

rutasPlazas.get('/plazas', async (peticion, respuesta) => {
  const nivelId = Number(peticion.query.nivel_id);

  if (!Number.isInteger(nivelId)) {
    return respuesta.status(400).json({ error: 'nivel_id tiene que ser un entero' });
  }

  const { data, error } = await db
    .from('plazas')
    .select('id, nivel_id, codigo, x, y, ancho, alto, tipo, estado, autorizacion, actualizado_en')
    .eq('nivel_id', nivelId)
    .order('codigo');

  if (error) return respuesta.status(500).json({ error: error.message });
  respuesta.json(data);
});