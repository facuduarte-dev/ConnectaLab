import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import { adminAuth } from '../middleware/adminAuth.js';

export const eventosRouter = Router();

const ESTADOS = ['libre', 'ocupado', 'reservado', 'sin_datos'];
const FUENTES = ['sensor', 'camara', 'manual'];

// POST /api/eventos
// Dispositivo. Body: { plaza_id, estado, fuente, confianza }
//
// Lo usa el puente serie para reportar lo que midio el sensor de una plaza
// (README 2.1.1 y 7.5). Es el unico camino por el que un dispositivo escribe
// estado.
//
// El trabajo lo hace registrar_evento(), no este archivo: inserta la fila en
// "eventos", recalcula la autorizacion segun el tipo de plaza y actualiza
// "plazas", todo en UNA transaccion. Hacerlo con dos llamadas sueltas desde
// aca abriria la ventana en la que el historial dice una cosa y el estado
// actual dice otra, y ademas obligaria a mantener la regla de la autorizacion
// escrita dos veces: en SQL y en JavaScript. Ver db/funciones.sql y README 4.3.
eventosRouter.post('/', deviceAuth, async (req, res, next) => {
  try {
    const { plaza_id, estado, fuente, confianza } = req.body;

    const plazaId = Number(plaza_id);

    if (!Number.isInteger(plazaId) || !estado || !fuente) {
      return res
        .status(400)
        .json({ error: 'Faltan campos: plaza_id (entero), estado, fuente' });
    }

    // Validar contra la lista y no dejar que reviente el enum: un valor mal
    // escrito no es una falla del servidor.
    if (!ESTADOS.includes(estado)) {
      return res.status(400).json({
        error: `estado tiene que ser uno de: ${ESTADOS.join(', ')}`,
      });
    }

    if (!FUENTES.includes(fuente)) {
      return res.status(400).json({
        error: `fuente tiene que ser una de: ${FUENTES.join(', ')}`,
      });
    }

    const confianzaNumero = confianza ?? 1.0;

    if (typeof confianzaNumero !== 'number' || confianzaNumero < 0 || confianzaNumero > 1) {
      return res.status(400).json({ error: 'confianza tiene que ser un numero entre 0 y 1' });
    }

    const { data, error } = await supabase.rpc('registrar_evento', {
      p_plaza_id: plazaId,
      p_estado: estado,
      p_fuente: fuente,
      p_confianza: confianzaNumero,
    });

    if (error) {
      // registrar_evento() levanta una excepcion propia cuando la plaza no
      // existe. Es un 404, no un 500: el pedido esta bien formado.
      if (/no existe/i.test(error.message ?? '')) {
        return res.status(404).json({ error: error.message });
      }
      throw error;
    }

    res.status(201).json(data);
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
