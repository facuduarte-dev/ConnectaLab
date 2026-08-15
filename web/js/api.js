import { supabase, observarLatido } from './supabase.js';

/**
 * Capa de datos.
 *
 * Todo el resto del frontend pide los datos por aca y nunca hace fetch por su
 * cuenta. La razon: en la fase 2 salen de un JSON local y en la fase 3 de la API
 * real. Si plano.js hablara directo con el servidor, cambiar de fuente
 * obligaria a tocar el plano. Asi solo se cambia la constante MODO.
 */

export const API = {
  // 'demo' -> lee datos/plazas-demo.json
  // 'real' -> pega contra el backend Express
  MODO: 'real',

  URL_BASE: 'http://localhost:3000/api',
  ARCHIVO_DEMO: 'datos/plazas-demo.json',

  /**
   * Niveles del estacionamiento, con las dimensiones del plano.
   * ancho_plano y alto_plano definen el sistema de coordenadas dentro del cual
   * se posicionan las plazas: son el viewBox del SVG.
   *
   * Van ordenados por 'orden' —de la planta baja hacia abajo— porque asi se
   * listan en el selector de niveles. Ordenar aca y no en el plano evita que el
   * orden dependa de como quedaron escritas las filas en el JSON o en la tabla.
   */
  async obtenerNiveles() {
    const niveles = this.MODO === 'demo'
      ? (await this._leerDemo()).niveles
      : await this._pedir(`${this.URL_BASE}/niveles`);

    return [...niveles].sort((a, b) => a.orden - b.orden);
  },

  /** Plazas de un nivel, con posicion en el plano y estado actual. */
  async obtenerPlazas(nivelId) {
    if (this.MODO === 'demo') {
      const datos = await this._leerDemo();
      return datos.plazas.filter((plaza) => plaza.nivel_id === nivelId);
    }
    return this._pedir(`${this.URL_BASE}/plazas?nivel_id=${nivelId}`);
  },

  
  /**
   * Cambia el estado de una plaza. Requiere sesion iniciada: el token va en el
   * header. No existe en modo demo —el JSON es de solo lectura— asi que falla
   * claro en vez de simular un exito que nunca ocurrio.
   */
  async cambiarEstado(plazaId, estado, token) {
    if (this.MODO === 'demo') {
      throw new Error('El modo demo es de solo lectura');
    }

    const respuesta = await fetch(`${this.URL_BASE}/plazas/${plazaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ estado })
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.json().catch(() => ({}));
      throw new Error(detalle.error ?? `HTTP ${respuesta.status}`);
    }

    return respuesta.json();
  },
  /**
   * Avisa cada vez que cambia una plaza en la base.
   *
   * Va aca por la misma razon que el resto de la capa: el plano no tiene que
   * saber de donde salen los datos ni como llegan. En modo demo no hay nada que
   * escuchar —un JSON no cambia solo— y devolver una funcion vacia deja que el
   * plano se escriba una sola vez para los dos modos.
   *
   * Escuchamos la TABLA, no la API. Cualquier cosa que toque plazas dispara el
   * evento: el panel, un update a mano en el editor SQL, o el sensor de la fase
   * 6. Si escucharamos el endpoint, un cambio que no pasara por Express seria
   * invisible.
   *
   *   alCambiar(plaza)  una plaza cambio: llega la fila entera, ya actualizada
   *   alReconectar()    el canal volvio despues de una caida: hay que releer todo
   *   alEstado(estado)  para mostrar el indicador de conexion
   *
   * Devuelve una funcion para cortar la suscripcion.
   */
  
  suscribirsePlazas({ alCambiar, alReconectar, alEstado = () => {} }) {
    if (this.MODO === 'demo') {
      alEstado('demo');
      return () => {};
    }

    // El primer SUBSCRIBED es la apertura normal del canal y no hay nada que
    // resincronizar: el plano acaba de cargar los datos. Del segundo en
    // adelante es una REconexion, y ahi si.
    let abiertoAntes = false;

    const canal = supabase
      .channel('plazas-en-vivo')   // cualquier nombre menos 'realtime'
      .on(
        'postgres_changes',
        // Solo UPDATE. Una plaza nueva o borrada es un cambio de la planta
        // fisica del parking, no algo que ocurra mientras alguien mira el
        // plano: para eso alcanza con recargar la pagina.
        { event: 'UPDATE', schema: 'public', table: 'plazas' },
        (mensaje) => alCambiar(mensaje.new)
      )
      .subscribe((estado) => {
        alEstado(estado);
        if (estado !== 'SUBSCRIBED') return;

        // Realtime no guarda historial: los cambios que ocurrieron mientras el
        // socket estuvo caido NO se reenvian al reconectar. Sin esta relectura
        // el plano se queda mostrando el estado del momento del corte y no hay
        // forma de que se entere.
        if (abiertoAntes) alReconectar();
        abiertoAntes = true;
      });

    // --- deteccion de caida --------------------------------------------
    //
    // El estado del canal NO alcanza. Si la maquina se queda sin internet pero
    // la interfaz de red sigue arriba, nadie cierra el socket: no llega ningun
    // FIN, el navegador lo sigue considerando abierto y subscribe() nunca se
    // entera. El indicador queda en verde mintiendo.
    //
    // Un indicador de conexion tiene que exigir senal de vida activa, no
    // conformarse con que nadie le haya avisado lo contrario.

    // 1. El navegador avisa al instante cuando se cae la interfaz de red. Es la
    //    capa mas rapida y la menos confiable: navigator.onLine mira si hay red,
    //    no si hay internet. Con el router prendido y el proveedor caido dice
    //    que si.
    const alPerderRed = () => alEstado('SIN_RED');
    const alVolverRed = () => alEstado('CONECTANDO');

    window.addEventListener('offline', alPerderRed);
    window.addEventListener('online', alVolverRed);

    // 2. El latido es la senal de vida de verdad, y la unica que detecta el caso
    //    "hay WiFi pero no hay internet": el mensaje sale y no vuelve nunca.
    //    Se exige ademas que el canal siga unido, porque un socket vivo con el
    //    canal caido tampoco esta recibiendo cambios.
    observarLatido((latido) => {
      if (latido === 'ok' && canal.state === 'joined') alEstado('SUBSCRIBED');
      if (latido === 'timeout' || latido === 'error')  alEstado('CHANNEL_ERROR');
    });

    return () => {
      window.removeEventListener('offline', alPerderRed);
      window.removeEventListener('online', alVolverRed);
      observarLatido(() => {});
      supabase.removeChannel(canal);
    };
  },
  /**
   * Referencias del plano: rampa, acceso peatonal, camara de entrada.
   * Son decoracion para que el plano se lea como un parking y no como una
   * grilla suelta de rectangulos. No estan en el modelo de datos todavia, asi
   * que en modo real no hay nada que traer y el plano se dibuja igual sin ellas.
   */
  async obtenerReferencias(nivelId) {
    if (this.MODO !== 'demo') return [];

    const datos = await this._leerDemo();
    return (datos.referencias || []).filter((ref) => ref.nivel_id === nivelId);
  },

  // --- interno ---------------------------------------------------------

  _demo: null,

  /**
   * Una sola lectura del archivo de demo para toda la pagina: niveles, plazas y
   * referencias salen del mismo JSON y pedirlo tres veces seria pedir lo mismo
   * tres veces. Se cachea la promesa, no el resultado, para que dos llamadas
   * simultaneas compartan el mismo fetch.
   *
   * Si falla se limpia el cache: guardar una promesa rechazada dejaria la
   * pagina rota hasta recargar, aunque el problema haya sido momentaneo.
   */
  _leerDemo() {
    if (!this._demo) {
      this._demo = this._pedir(this.ARCHIVO_DEMO).catch((error) => {
        this._demo = null;
        throw error;
      });
    }
    return this._demo;
  },

  async _pedir(url) {
    const respuesta = await fetch(url);

    // fetch NO lanza excepcion con un 404 o un 500: solo falla si la red se
    // cae. Hay que revisar .ok a mano o los errores del servidor pasan
    // silenciosamente como si fueran datos.
    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status}`);
    }

    return respuesta.json();
  }
};
