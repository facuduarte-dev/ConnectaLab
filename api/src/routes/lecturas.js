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
// Dispositivo (camara). Body: { plaza_id, matricula_hash, confianza }
// matricula_hash puede venir null (el OCR no pudo leer nada). Nunca llega
// la matricula en texto plano, solo su HMAC (seccion 6 del README) — este
// backend no conoce la clave del HMAC, solo compara hashes.
lecturasRouter.post('/', deviceAuth, async (req, res, next) => {
  try {
    const { plaza_id, matricula_hash, confianza } = req.body;

    if (!plaza_id || confianza === undefined) {
      return res.status(400).json({ error: 'Faltan campos: plaza_id, confianza' });
    }

    let resultado;
    let vehiculo_id = null;

    if (!matricula_hash || confianza < UMBRAL_CONFIANZA) {
      // El OCR no leyo nada, o leyo con poca confianza: no se puede verificar.
      resultado = 'no_verificable';
    } else {
      // Necesitamos el estacionamiento_id de la plaza para buscar en SU padron.
      const { data: plaza, error: errorPlaza } = await supabase
        .from('plazas')
        .select('nivel_id, niveles!inner(estacionamiento_id)')
        .eq('id', plaza_id)
        .maybeSingle();

      if (errorPlaza) throw errorPlaza;
      if (!plaza) return res.status(404).json({ error: 'Plaza no encontrada' });

      const estacionamientoId = plaza.niveles.estacionamiento_id;
      const hoy = new Date().toISOString().slice(0, 10);

      const { data: vehiculo, error: errorVehiculo } = await supabase
        .from('vehiculos_autorizados')
        .select('id')
        .eq('estacionamiento_id', estacionamientoId)
        .eq('matricula_hash', matricula_hash)
        .eq('activo', true)
        .lte('vigente_desde', hoy)
        .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)
        .maybeSingle();

      if (errorVehiculo) throw errorVehiculo;

      if (vehiculo) {
        resultado = 'autorizado';
        vehiculo_id = vehiculo.id;
      } else {
        resultado = 'no_autorizado';
      }
    }

    // 1. Se guarda la lectura (solo hash y confianza, nunca la matricula ni la imagen).
    const { data: lectura, error: errorLectura } = await supabase
      .from('lecturas')
      .insert({ plaza_id, matricula_hash: matricula_hash ?? null, confianza, resultado, vehiculo_id })
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
          motivo: 'Matricula leida con confianza suficiente y ausente del padron',
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
