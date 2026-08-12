/**
 * Capa de datos.
 *
 * Todo el resto del frontend pide los datos por aca y nunca hace fetch por su
 * cuenta. La razon: en la fase 2 salen de un JSON local y en la fase 3 de la API
 * real. Si plano.js hablara directo con el servidor, cambiar de fuente
 * obligaria a tocar el plano. Asi solo se cambia la constante MODO.
 */

const API = {
  // 'demo' -> lee datos/plazas-demo.json
  // 'real' -> pega contra el backend Express
  MODO: 'demo',

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
