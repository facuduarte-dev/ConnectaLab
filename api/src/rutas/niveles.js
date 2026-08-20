import { Router } from 'express';
import { autenticarUsuario } from '../middleware/autenticarUsuario.js';
import { generarPlano, MAXIMO_FILAS } from '../plano/generar.js';
import { db } from '../db.js';

export const rutasNiveles = Router();

// Topes de cordura. No son reglas de negocio: son el limite de lo que tiene
// sentido dibujar en una pantalla y de lo que se puede pedir sin equivocarse
// tipeando un cero de mas.
const MAXIMO_PLAZAS   = 300;
const MAXIMO_POR_FILA = 20;

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

/**
 * Alta de un piso.
 *
 * El cuerpo lleva intencion, no geometria:
 *   { "nombre": "Subsuelo 3", "cantidad": 24, "por_fila": 8 }
 *
 * Toda la validacion pasa ANTES de tocar la base. Dejar que reviente el insert
 * daria un 500 con un mensaje de Postgres, y un dato mal tipeado no es un
 * error del servidor.
 */
rutasNiveles.post('/niveles', autenticarUsuario, async (peticion, respuesta) => {
  const { nombre, cantidad, por_fila } = peticion.body;
  const estacionamientoId = Number(peticion.body.estacionamiento_id ?? 1);

  const nombreLimpio = String(nombre ?? '').trim();

  if (!nombreLimpio) {
    return respuesta.status(400).json({ error: 'El nombre del piso no puede estar vacío' });
  }

  if (nombreLimpio.length > 40) {
    return respuesta.status(400).json({ error: 'El nombre no puede pasar de 40 caracteres' });
  }

  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAXIMO_PLAZAS) {
    return respuesta.status(400).json({
      error: `cantidad tiene que ser un entero entre 1 y ${MAXIMO_PLAZAS}`
    });
  }

  if (!Number.isInteger(por_fila) || por_fila < 1 || por_fila > MAXIMO_POR_FILA) {
    return respuesta.status(400).json({
      error: `por_fila tiene que ser un entero entre 1 y ${MAXIMO_POR_FILA}`
    });
  }

  // Cada fila lleva una letra y hay 26. Es un limite del formato de codigo, no
  // del plano, y por eso el mensaje lo dice asi.
  if (Math.ceil(cantidad / por_fila) > MAXIMO_FILAS) {
    return respuesta.status(400).json({
      error: `Con ${por_fila} plazas por fila quedan más de ${MAXIMO_FILAS} filas y se acaban las letras para los códigos`
    });
  }

  const { plazas, ancho_plano, alto_plano } = generarPlano(cantidad, por_fila);

  const { data, error } = await db.rpc('crear_nivel', {
    p_estacionamiento_id: estacionamientoId,
    p_nombre:             nombreLimpio,
    p_ancho_plano:        ancho_plano,
    p_alto_plano:         alto_plano,
    p_plazas:             plazas
  });

  if (error) return respuesta.status(500).json({ error: error.message });

  // 201 y no 200: se creo un recurso nuevo. plazas_creadas va aparte porque la
  // funcion devuelve la fila de niveles, que no sabe cuantas plazas se
  // insertaron, y el panel lo necesita para el mensaje de confirmacion.
  respuesta.status(201).json({ ...data, plazas_creadas: plazas.length });
});

/**
 * Baja de un piso, solo si nunca reporto nada. La regla la aplica la funcion
 * borrar_nivel(); aca solo se traduce su negativa a un codigo HTTP.
 */
rutasNiveles.delete('/niveles/:id', autenticarUsuario, async (peticion, respuesta) => {
  const id = Number(peticion.params.id);

  if (!Number.isInteger(id)) {
    return respuesta.status(400).json({ error: 'id tiene que ser un entero' });
  }

  const { error } = await db.rpc('borrar_nivel', { p_nivel_id: id });

  if (error) {
    // 23001 es restrict_violation, el errcode que levanta borrar_nivel cuando
    // el piso tiene historial. Es un 409 Conflict: el pedido esta bien formado
    // y el servidor funciona, pero el estado actual del recurso no lo permite.
    // Un 500 haria pensar que se rompio algo.
    const esConflicto = error.code === '23001' || /no se puede borrar/i.test(error.message ?? '');
    return respuesta.status(esConflicto ? 409 : 500).json({ error: error.message });
  }

  // 204 No Content: se borro y no hay nada que devolver.
  respuesta.status(204).end();
});