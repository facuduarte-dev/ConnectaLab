import { autenticarUsuario } from '../middleware/autenticarUsuario.js';
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

const ESTADOS = ['libre', 'ocupado', 'reservado', 'sin_datos'];

rutasPlazas.patch('/plazas/:id', autenticarUsuario, async (peticion, respuesta) => {
  const id = Number(peticion.params.id);
  const { estado } = peticion.body;

  if (!Number.isInteger(id)) {
    return respuesta.status(400).json({ error: 'id tiene que ser un entero' });
  }

  // Validar contra la lista aca y no dejar que reviente el enum: sin esto un
  // estado mal escrito sale como 500 y parece un problema del servidor.
  if (!ESTADOS.includes(estado)) {
    return respuesta.status(400).json({
      error: `estado tiene que ser uno de: ${ESTADOS.join(', ')}`
    });
  }

  const { data, error } = await db.rpc('registrar_evento', {
    p_plaza_id: id,
    p_estado: estado,
    p_fuente: 'manual'
  });

  if (error) return respuesta.status(500).json({ error: error.message });
  respuesta.json(data);
});