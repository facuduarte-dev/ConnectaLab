/**
 * Mapa Leaflet + teselas de OpenStreetMap.
 *
 * Aca esta la unica integracion real con OpenStreetMap del sitio: la capa de
 * teselas. Todo lo demas (estado de las plazas) sale de nuestra propia base.
 */

// Plaza Independencia. Sirve como centro por defecto hasta que se cargan las
// plazas y el mapa se reencuadra solo.
const CENTRO_MONTEVIDEO = [-34.9060, -56.1985];
const ZOOM_INICIAL = 16;

const COLORES = {
  libre:     '#2e7d32',
  ocupado:   '#c62828',
  reservado: '#1565c0',
  sin_datos: '#757575'
};

const mapa = L.map('mapa').setView(CENTRO_MONTEVIDEO, ZOOM_INICIAL);

/**
 * LA INTEGRACION CON OSM.
 *
 * El servidor de teselas no es una API REST: no devuelve JSON, devuelve PNGs.
 * La URL es una plantilla y Leaflet reemplaza las llaves segun lo que necesite
 * dibujar en pantalla:
 *
 *   {z} nivel de zoom  (0 = el planeta entero, 19 = una cuadra)
 *   {x} columna de la grilla en ese zoom
 *   {y} fila de la grilla en ese zoom
 *
 * Con zoom 16 sobre Montevideo, {z}/{x}/{y} se resuelve a algo como
 * https://tile.openstreetmap.org/16/22861/39561.png
 *
 * Leaflet calcula que teselas hacen falta, las pide, las pega en una grilla y
 * las recicla al arrastrar. Por eso no hay que pedirle nada mas que la URL.
 *
 * La atribucion NO es opcional: la licencia ODbL de OSM la exige, y la Tile
 * Usage Policy tambien. Es la contraprestacion por usar infraestructura donada.
 */
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(mapa);

/** Devuelve el circulo de la plaza ya estilado segun estado y tipo. */
function crearMarcador(plaza) {
  const esDiscapacidad = plaza.tipo === 'discapacidad';

  return L.circleMarker([plaza.lat, plaza.lng], {
    radius: esDiscapacidad ? 9 : 7,
    fillColor: COLORES[plaza.estado] || COLORES.sin_datos,
    fillOpacity: plaza.estado === 'sin_datos' ? 0.45 : 0.9,
    // El borde violeta y mas grueso distingue las plazas de discapacidad sin
    // gastar un color de relleno, que ya esta ocupado por el estado.
    color: esDiscapacidad ? '#6a1b9a' : '#ffffff',
    weight: esDiscapacidad ? 3 : 2
  });
}

function contenidoPopup(plaza) {
  const filas = [
    ['Zona', plaza.zona],
    ['Tipo', plaza.tipo],
    ['Estado', plaza.estado.replace('_', ' ')]
  ];

  // La autorizacion solo tiene sentido en plazas de discapacidad; en el resto
  // el valor es siempre 'no_aplica' y mostrarlo confunde.
  if (plaza.tipo === 'discapacidad') {
    filas.push(['Autorizacion', plaza.autorizacion.replace('_', ' ')]);
  }

  filas.push(['Actualizado', new Date(plaza.actualizado_en).toLocaleString('es-UY')]);

  const dl = filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  return `<div class="popup-plaza"><h3>Plaza ${plaza.codigo}</h3><dl>${dl}</dl></div>`;
}

function mostrarError(mensaje) {
  const aviso = document.createElement('p');
  aviso.className = 'error';
  aviso.textContent = mensaje;
  document.getElementById('mapa').before(aviso);
}

async function dibujarPlazas() {
  let plazas;

  try {
    plazas = await API.obtenerPlazas();
  } catch (error) {
    // El mapa base ya esta dibujado, asi que el sitio sigue siendo util
    // aunque las plazas no carguen. Fallar sin pantalla en blanco.
    mostrarError(`No se pudieron cargar las plazas: ${error.message}`);
    return;
  }

  const grupo = L.layerGroup().addTo(mapa);

  plazas.forEach((plaza) => {
    crearMarcador(plaza)
      .bindPopup(contenidoPopup(plaza))
      .bindTooltip(plaza.codigo, { direction: 'top' })
      .addTo(grupo);
  });

  // Reencuadra el mapa para que entren todas las plazas, en vez de confiar en
  // el centro fijo de arriba. Cuando se agreguen plazas de otro barrio el
  // encuadre se ajusta solo.
  if (plazas.length > 0) {
    encuadrar(L.latLngBounds(plazas.map((p) => [p.lat, p.lng])).pad(0.25));
  }
}

/**
 * fitBounds calcula el zoom a partir del tamano en pixeles del contenedor. Si
 * el div todavia mide 0x0 -- pestana abierta en segundo plano, contenedor con
 * display:none, panel que aparece despues -- el calculo da el zoom minimo y el
 * mapa arranca mostrando el planeta entero en vez de la cuadra.
 *
 * Por eso se espera a que el contenedor tenga alto real antes de encuadrar.
 */
function encuadrar(limites) {
  const contenedor = mapa.getContainer();

  if (contenedor.clientHeight > 0) {
    mapa.fitBounds(limites);
    return;
  }

  const observador = new ResizeObserver(() => {
    if (contenedor.clientHeight === 0) return;
    observador.disconnect();
    mapa.invalidateSize();  // Leaflet cachea el tamano: hay que avisarle
    mapa.fitBounds(limites);
  });

  observador.observe(contenedor);
}

dibujarPlazas();
