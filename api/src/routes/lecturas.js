import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { deviceAuth } from '../middleware/deviceAuth.js';
import { adminAuth } from '../middleware/adminAuth.js';

export const lecturasRouter = Router();

const UMBRAL_CONFIANZA = 0.8;

// GET /api/lecturas/pendientes
// Dispositivo (camara). Plazas de discapacidad que se acaban de ocupar
// (autorizacion = "pendiente") y todavia no tienen una lectura resuelta.
// El servicio de camara (seccion 8 del README) hace polling a esta ruta.
lecturasRouter.get('/pendientes', deviceAuth, async (req, res, next) => {
  try {
    // El dispositivo sólo ve las plazas de SU estacionamiento. Sin este filtro
    // cualquier token de cámara lista las plazas pendientes de todos.
    const { data, error } = await supabase
      .from('plazas')
      .select('id, codigo, nivel_id, niveles!inner(estacionamiento_id)')
      .eq('tipo', 'discapacidad')
      .eq('autorizacion', 'pendiente')
      .eq('niveles.estacionamiento_id', req.dispositivo.estacionamiento_id);

    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/lecturas
// Dispositivo (camara). Body: { plaza_id, matricula_hash, confianza, distintivo_di }
// matricula_hash puede venir null (el OCR no pudo leer nada), y en ese caso
// distintivo_di viene null tambien: sin matricula no hay distintivo que mirar.
// Nunca llega la matricula en texto plano, solo su HMAC (seccion 6 del README).
// Justamente por eso el distintivo lo comprueba el lector y no este archivo: de
// un hash no se puede recuperar el texto de la chapa.
lecturasRouter.post('/', deviceAuth, async (req, res, next) => {
  try {
    const { plaza_id, matricula_hash, confianza, distintivo_di } = req.body;

    if (!plaza_id || confianza === undefined) {
      return res.status(400).json({ error: 'Faltan campos: plaza_id, confianza' });
    }

    // Si hubo lectura, el distintivo es obligatorio y booleano. Sin esta
    // validacion, una version vieja del lector —o el campo mal escrito— llegaria
    // como undefined, y undefined es falso: la lectura se convertiria en "no
    // lleva distintivo" y en una alerta contra un vehiculo que quiza si lo
    // tenia. Un campo que falta no puede volverse una acusacion.
    if (matricula_hash && typeof distintivo_di !== 'boolean') {
      return res.status(400).json({
        error: 'Falta distintivo_di (booleano) en una lectura con matricula_hash',
      });
    }

    const { data: plaza, error: errorPlaza } = await supabase
      .from('plazas')
      .select('tipo')
      .eq('id', plaza_id)
      .maybeSingle();

    if (errorPlaza) throw errorPlaza;
    if (!plaza) return res.status(404).json({ error: 'Plaza no encontrada' });

    // La POLITICA vive aca y no en el lector: el lector reporta un hecho que
    // observo —esta chapa lleva el distintivo— y el backend decide que
    // significa eso. Si manana cambia que amerita alerta, se toca este archivo
    // y no hay que reinstalar el programa Java en la computadora del parking.
    let resultado;

    if (!matricula_hash || confianza < UMBRAL_CONFIANZA) {
      resultado = 'no_verificable';
    } else if (plaza.tipo !== 'discapacidad') {
      // Una camara no deberia reportar sobre una plaza comun, pero si pasa no
      // es una infraccion: ahi no hay nada que verificar.
      resultado = 'autorizado';
    } else {
      resultado = distintivo_di ? 'autorizado' : 'no_autorizado';
    }

    // 1. Se guarda la lectura (solo hash y confianza, nunca la matricula ni la imagen).
    const { data: lectura, error: errorLectura } = await supabase
      .from('lecturas')
      .insert({ plaza_id, matricula_hash: matricula_hash ?? null, confianza, resultado })
      .select()
      .single();

    if (errorLectura) throw errorLectura;

    // 2. La lectura resuelve la autorizacion de la plaza.
    const { error: errorUpdate } = await supabase
      .from('plazas')
      .update({ autorizacion: resultado, actualizado_en: new Date().toISOString() })
      .eq('id', plaza_id);

    if (errorUpdate) throw errorUpdate;

    // 3. Si no esta autorizado, se encola para revision humana. El sistema
    //    nunca sanciona solo: la alerta es para que una persona la revise.
    if (resultado === 'no_autorizado') {
      const { error: errorAlerta } = await supabase
        .from('alertas')
        .insert({
          plaza_id,
          lectura_id: lectura.id,
          motivo: 'Vehiculo sin distintivo de discapacidad en plaza reservada',
        });

      if (errorAlerta) throw errorAlerta;
    }

    res.status(201).json(lectura);
  } catch (err) {
    next(err);
  }
});

// GET /api/lecturas?plaza_id=
// Administracion. Historial de lecturas de una plaza reservada.
lecturasRouter.get('/', adminAuth, async (req, res, next) => {
  try {
    const { plaza_id } = req.query;

    let query = supabase.from('lecturas').select('*').order('creado_en', { ascending: false });
    if (plaza_id) query = query.eq('plaza_id', plaza_id);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    next(err);
  }
});
