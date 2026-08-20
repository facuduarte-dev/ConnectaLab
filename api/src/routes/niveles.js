import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { generarPlano, MAXIMO_FILAS } from '../plano/generar.js';

export const nivelesRouter = Router();

// Topes de cordura. No son reglas de negocio: son el limite de lo que tiene
// sentido dibujar en una pantalla y de lo que se puede pedir sin equivocarse
// tipeando un cero de mas.
const MAXIMO_PLAZAS = 300;
const MAXIMO_POR_FILA = 20;

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

// POST /api/niveles
// Administracion. Alta de un piso con todas sus plazas.
//
// El cuerpo lleva intencion, no geometria:
//   { "nombre": "Subsuelo 3", "cantidad": 24, "por_fila": 8 }
//
// Las coordenadas las calcula generarPlano(). Si el cuerpo trajera x e y,
// cualquier cliente que quisiera dar de alta un piso tendria que saber dibujar
// un parking.
//
// Toda la validacion pasa ANTES de tocar la base. Dejar que reviente el insert
// daria un 500 con un mensaje de Postgres, y un dato mal tipeado no es un error
// del servidor.
nivelesRouter.post('/', adminAuth, async (req, res, next) => {
  try {
    const { nombre, cantidad, por_fila } = req.body;
    const estacionamientoId = Number(req.body.estacionamiento_id ?? 1);

    const nombreLimpio = String(nombre ?? '').trim();

    if (!nombreLimpio) {
      return res.status(400).json({ error: 'El nombre del piso no puede estar vacío' });
    }

    if (nombreLimpio.length > 40) {
      return res.status(400).json({ error: 'El nombre no puede pasar de 40 caracteres' });
    }

    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAXIMO_PLAZAS) {
      return res.status(400).json({
        error: `cantidad tiene que ser un entero entre 1 y ${MAXIMO_PLAZAS}`,
      });
    }

    if (!Number.isInteger(por_fila) || por_fila < 1 || por_fila > MAXIMO_POR_FILA) {
      return res.status(400).json({
        error: `por_fila tiene que ser un entero entre 1 y ${MAXIMO_POR_FILA}`,
      });
    }

    // Cada fila lleva una letra y hay 26. Es un limite del formato de codigo, no
    // del plano, y por eso el mensaje lo dice asi.
    if (Math.ceil(cantidad / por_fila) > MAXIMO_FILAS) {
      return res.status(400).json({
        error: `Con ${por_fila} plazas por fila quedan más de ${MAXIMO_FILAS} filas y se acaban las letras para los códigos`,
      });
    }

    const { plazas, ancho_plano, alto_plano } = generarPlano(cantidad, por_fila);

    // crear_nivel() inserta el nivel y sus plazas en UNA transaccion. Hecho
    // desde aca serian dos viajes independientes, y un fallo en el segundo
    // dejaria un piso vacio en la base que nadie pidio (ver db/funciones.sql).
    const { data, error } = await supabase.rpc('crear_nivel', {
      p_estacionamiento_id: estacionamientoId,
      p_nombre: nombreLimpio,
      p_ancho_plano: ancho_plano,
      p_alto_plano: alto_plano,
      p_plazas: plazas,
    });

    if (error) throw error;

    // 201 y no 200: se creo un recurso nuevo. plazas_creadas va aparte porque la
    // funcion devuelve la fila de niveles, que no sabe cuantas plazas se
    // insertaron, y el panel lo necesita para el mensaje de confirmacion.
    res.status(201).json({ ...data, plazas_creadas: plazas.length });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/niveles/:id
// Administracion. Baja de un piso, solo si nunca reporto nada. La regla la
// aplica borrar_nivel(); aca solo se traduce su negativa a un codigo HTTP.
nivelesRouter.delete('/:id', adminAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'id tiene que ser un entero' });
    }

    const { error } = await supabase.rpc('borrar_nivel', { p_nivel_id: id });

    if (error) {
      // 23001 es restrict_violation, el errcode que levanta borrar_nivel cuando
      // el piso tiene historial. Es un 409 Conflict: el pedido esta bien formado
      // y el servidor funciona, pero el estado actual del recurso no lo permite.
      // Un 500 haria pensar que se rompio algo.
      const esConflicto =
        error.code === '23001' || /no se puede borrar/i.test(error.message ?? '');

      if (esConflicto) return res.status(409).json({ error: error.message });
      throw error;
    }

    // 204 No Content: se borro y no hay nada que devolver.
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
