/**
 * Capa de datos.
 *
 * Todo el resto del frontend pide las plazas por aca y nunca hace fetch por su
 * cuenta. La razon: en la fase 2 los datos salen de un JSON local y en la fase 3
 * de la API real. Si mapa.js hablara directo con el servidor, cambiar de fuente
 * obligaria a tocar el mapa. Asi solo se cambia la constante MODO.
 */

const API = {
  // 'demo' -> lee datos/plazas-demo.json
  // 'real' -> pega contra el backend Express
  MODO: 'demo',

  URL_BASE: 'http://localhost:3000/api',

  /**
   * Devuelve el array de plazas con su estado actual.
   * La forma del JSON de demo es identica a la que va a devolver
   * GET /api/plazas, justamente para que el cambio de fase sea gratis.
   */
  async obtenerPlazas() {
    const url = this.MODO === 'demo'
      ? 'datos/plazas-demo.json'
      : `${this.URL_BASE}/plazas`;

    const respuesta = await fetch(url);

    // fetch NO lanza excepcion con un 404 o un 500: solo falla si la red se
    // cae. Hay que revisar .ok a mano o los errores del servidor pasan
    // silenciosamente como si fueran datos.
    if (!respuesta.ok) {
      throw new Error(`No se pudieron cargar las plazas (HTTP ${respuesta.status})`);
    }

    return respuesta.json();
  }
};
