import { Router } from 'express';
import { db } from '../db.js';

export const rutasNiveles = Router();

rutasNiveles.get('/niveles', async (_peticion, respuesta) => {
  const { data, error } = await db
    .from('niveles')
    .select('id, estacionamiento_id, nombre, orden, ancho_plano, alto_plano, estacionamientos(nombre)')
    .order('orden');

  if (error) return respuesta.status(500).json({ error: error.message });

  // El JSON de demo trae el nombre del estacionamiento aplanado y plano.js lo
  // lee como nivel.estacionamiento. Sin este mapeo el titulo de la pagina
  // cambia y la fase 3 no se ve identica.
  respuesta.json(data.map(({ estacionamientos, ...nivel }) => ({
    ...nivel,
    estacionamiento: estacionamientos.nombre
  })));
});