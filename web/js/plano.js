import { API } from './api.js';
/**
 * Plano del nivel en SVG.
 *
 * Reemplaza al mapa Leaflet del enfoque anterior. Un parking privado no se
 * ubica por latitud y longitud sino por nivel y posicion dentro del plano, asi
 * que las plazas son rectangulos en coordenadas propias. No hace falta ninguna
 * libreria: el navegador dibuja SVG solo.
 *
 * El color lo pone el CSS a partir de las clases del <g>, no este archivo. Asi
 * la leyenda, los planos chicos y el plano grande no pueden quedar con colores
 * distintos.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ETIQUETA_ESTADO = {
  libre:     'Libre',
  ocupado:   'Ocupado',
  reservado: 'Reservado',
  sin_datos: 'Sin datos'
};

const ETIQUETA_TIPO = {
  normal:       'Normal',
  discapacidad: 'Discapacidad',
  carga:        'Carga',
  moto:         'Moto'
};

const ETIQUETA_AUTORIZACION = {
  no_aplica:      'No aplica',
  pendiente:      'Pendiente',
  autorizado:     'Autorizado',
  no_autorizado:  'No autorizado',
  no_verificable: 'No verificable'
};

// Marca dentro del rectangulo para los tipos que no son 'normal'. El tipo no
// puede ir por color: el color ya lo usa el estado.
const MARCA_TIPO = {
  discapacidad: '♿',
  carga:        'Carga',
  moto:         'Moto'
};

const ORDEN_ESTADOS = ['libre', 'ocupado', 'reservado', 'sin_datos'];

// Un elemento por nivel: { nivel, plazas, referencias }. Se carga una sola vez
// al arrancar, porque los planos chicos necesitan las plazas de TODOS los
// niveles para poder dibujarse, no solo las del nivel que se esta mirando.
let niveles = [];
let nivelActual = null;
let plazaSeleccionada = null;


/**
 * A Date, venga de donde venga.
 *
 * La API devuelve el timestamp en ISO ('...T19:22:31.123456+00:00') y el canal
 * de tiempo real lo entrega tal como lo escribe Postgres, con un espacio en vez
 * de la T y el offset sin minutos ('... 19:22:31.123456+00'). new Date() con el
 * segundo formato depende del navegador: Chrome lo parsea, otros devuelven
 * Invalid Date. Normalizar aca evita tener que acordarse en cada uso.
 */
function aFecha(valor) {
  const iso = String(valor)
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')        // el estandar admite 3 decimales, Postgres manda 6
    .replace(/([+-]\d{2})$/, '$1:00');    // '+00' -> '+00:00'
  return new Date(iso);
}

/** Crea un elemento SVG con sus atributos. document.createElement no sirve
 *  aca: sin el namespace el navegador crea un elemento HTML desconocido que no
 *  se dibuja. */
function crearSVG(nombre, atributos = {}, texto = null) {
  const elemento = document.createElementNS(SVG_NS, nombre);

  for (const [clave, valor] of Object.entries(atributos)) {
    elemento.setAttribute(clave, valor);
  }
  if (texto !== null) elemento.textContent = texto;

  return elemento;
}

function contarLibres(plazas) {
  return plazas.filter((plaza) => plaza.estado === 'libre').length;
}

// --- plano grande ------------------------------------------------------

function dibujarReferencia(referencia) {
  const grupo = crearSVG('g', { class: `referencia referencia-${referencia.tipo}` });

  grupo.append(crearSVG('rect', {
    x: referencia.x,
    y: referencia.y,
    width: referencia.ancho,
    height: referencia.alto,
    rx: 4
  }));

  grupo.append(crearSVG('text', {
    x: referencia.x + referencia.ancho / 2,
    y: referencia.y + referencia.alto / 2,
    'text-anchor': 'middle',
    'dominant-baseline': 'central'
  }, referencia.etiqueta));

  return grupo;
}

function dibujarPlaza(plaza) {
    const grupo = crearSVG('g', {
    class: `plaza estado-${plaza.estado} tipo-${plaza.tipo}`,
    // Con que plaza se corresponde cada <g>. Es lo que permite repintar una
    // sola cuando llega un cambio, en vez de volver a dibujar el plano entero.
    'data-plaza-id': plaza.id,
    tabindex: '0',
    role: 'button',
    'aria-label': `Plaza ${plaza.codigo}, ${ETIQUETA_TIPO[plaza.tipo]}, ${ETIQUETA_ESTADO[plaza.estado]}`
  });

  grupo.append(crearSVG('rect', {
    x: plaza.x,
    y: plaza.y,
    width: plaza.ancho,
    height: plaza.alto,
    rx: 3
  }));

  const centroX = plaza.x + plaza.ancho / 2;

  grupo.append(crearSVG('text', {
    class: 'codigo',
    x: centroX,
    y: plaza.y + 16,
    'text-anchor': 'middle'
  }, plaza.codigo));

  if (MARCA_TIPO[plaza.tipo]) {
    grupo.append(crearSVG('text', {
      class: `marca marca-${plaza.tipo}`,
      x: centroX,
      y: plaza.y + plaza.alto - 12,
      'text-anchor': 'middle'
    }, MARCA_TIPO[plaza.tipo]));
  }

  grupo.addEventListener('click', () => seleccionar(plaza, grupo));

  // Con el teclado, Enter y barra espaciadora son el equivalente al clic.
  // preventDefault en la barra evita que la pagina baje una pantalla.
  grupo.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    evento.preventDefault();
    seleccionar(plaza, grupo);
  });

  return grupo;
}

function dibujarPlano({ nivel, plazas, referencias }) {
  const svg = crearSVG('svg', {
    class: 'plano-svg',
    // El viewBox son las dimensiones del nivel guardadas en la base. El SVG se
    // escala solo al ancho disponible sin tocar ninguna coordenada, y por eso
    // el mismo codigo sirve para el plano grande y para los chicos.
    viewBox: `0 0 ${nivel.ancho_plano} ${nivel.alto_plano}`,
    role: 'group',
    'aria-label': `Plano de ${nivel.nombre}`
  });

  svg.append(crearSVG('rect', {
    class: 'piso',
    x: 0,
    y: 0,
    width: nivel.ancho_plano,
    height: nivel.alto_plano
  }));

  // Las referencias van antes que las plazas: en SVG no hay z-index, dibuja
  // encima lo que aparece despues en el documento.
  referencias.forEach((referencia) => svg.append(dibujarReferencia(referencia)));
  plazas.forEach((plaza) => svg.append(dibujarPlaza(plaza)));

  document.getElementById('plano').replaceChildren(svg);
}

// --- planos chicos (selector de niveles) -------------------------------

/**
 * La misma planta, sin texto ni referencias ni interaccion.
 * A un cuarto del tamano los codigos de plaza no se leerian igual, y el
 * proposito del plano chico es otro: mostrar de un vistazo donde hay lugar.
 * Va aria-hidden porque el <button> que lo contiene ya dice el nivel y cuantas
 * plazas libres tiene; leer 30 rectangulos ademas seria ruido.
 */
function dibujarMini({ nivel, plazas }) {
  const svg = crearSVG('svg', {
    class: 'mini-svg',
    viewBox: `0 0 ${nivel.ancho_plano} ${nivel.alto_plano}`,
    'aria-hidden': 'true'
  });

  svg.append(crearSVG('rect', {
    class: 'piso',
    x: 0,
    y: 0,
    width: nivel.ancho_plano,
    height: nivel.alto_plano
  }));

  plazas.forEach((plaza) => {
    svg.append(crearSVG('rect', {
      class: `mini-plaza estado-${plaza.estado} tipo-${plaza.tipo}`,
      // Mismo atributo que en el plano grande. Por eso repintarMini busca
      // acotado a #lista-niveles y repintarPlaza a #plano: si no, el mismo id
      // aparece dos veces en el documento y querySelector devuelve cualquiera.
      'data-plaza-id': plaza.id,
      x: plaza.x,
      y: plaza.y,
      width: plaza.ancho,
      height: plaza.alto,
      rx: 2
    }));
  });

  return svg;
}

function dibujarSelectorNiveles() {
  const lista = document.getElementById('lista-niveles');

  lista.replaceChildren(...niveles.map((datos) => {
    const libres = contarLibres(datos.plazas);

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'nivel';
    boton.dataset.nivelId = datos.nivel.id;
    boton.setAttribute('aria-label', `${datos.nivel.nombre}, ${libres} plazas libres`);

    const nombre = document.createElement('span');
    nombre.className = 'nombre';
    nombre.textContent = datos.nivel.nombre;

    const libresTexto = document.createElement('span');
    libresTexto.className = 'libres';
    libresTexto.textContent = `${libres} ${libres === 1 ? 'libre' : 'libres'}`;

    boton.append(nombre, dibujarMini(datos), libresTexto);
    boton.addEventListener('click', () => cambiarNivel(datos.nivel.id));

    const item = document.createElement('li');
    item.append(boton);
    return item;
  }));
}

/** Marca cual de los planos chicos corresponde al que se esta mirando.
 *  aria-current="true" es lo que anuncia el lector de pantalla; la clase es
 *  solo para el CSS. */
function marcarNivelActivo(nivelId) {
  document.querySelectorAll('#lista-niveles .nivel').forEach((boton) => {
    const activo = Number(boton.dataset.nivelId) === nivelId;
    boton.classList.toggle('activo', activo);
    boton.setAttribute('aria-current', activo ? 'true' : 'false');
  });
}

// --- estado de la pagina -----------------------------------------------

function seleccionar(plaza, grupo) {
  if (plazaSeleccionada) plazaSeleccionada.classList.remove('seleccionada');
  grupo.classList.add('seleccionada');
  plazaSeleccionada = grupo;
  mostrarDetalle(plaza);
}

/** Separado de seleccionar() porque cuando llega un cambio por el canal hay que
 *  refrescar el detalle de la plaza abierta sin volver a seleccionarla. */
function mostrarDetalle(plaza) {
  const filas = [
    ['Tipo', ETIQUETA_TIPO[plaza.tipo]],
    ['Estado', ETIQUETA_ESTADO[plaza.estado]]
  ];

  // La autorizacion solo tiene sentido en plazas de discapacidad; en el resto
  // el valor es siempre 'no_aplica' y mostrarlo confunde.
  if (plaza.tipo === 'discapacidad') {
    filas.push(['Autorización', ETIQUETA_AUTORIZACION[plaza.autorizacion]]);
  }

  filas.push(['Actualizado', aFecha(plaza.actualizado_en).toLocaleString('es-UY')]);

  document.getElementById('detalle').innerHTML = `
    <h2>Plaza ${plaza.codigo}</h2>
    <dl>${filas.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
  `;
}

function limpiarDetalle() {
  plazaSeleccionada = null;
  document.getElementById('detalle').innerHTML = `
    <h2>Detalle</h2>
    <p class="vacio">Seleccione una plaza del plano para ver su detalle.</p>
  `;
}

function actualizarResumen(plazas) {
  const conteo = ORDEN_ESTADOS.map((estado) => ({
    estado,
    cantidad: plazas.filter((plaza) => plaza.estado === estado).length
  }));

  const resumen = document.getElementById('resumen');

  resumen.replaceChildren(...conteo.map(({ estado, cantidad }) => {
    const item = document.createElement('li');
    item.className = `contador estado-${estado}`;
    item.innerHTML = `<strong>${cantidad}</strong> ${ETIQUETA_ESTADO[estado]}`;
    return item;
  }));
}

// --- tiempo real -------------------------------------------------------

const TEXTO_CONEXION = {
  SUBSCRIBED:    ['vivo',       'En vivo'],
  CHANNEL_ERROR: ['caido',      'Sin conexión en vivo'],
  TIMED_OUT:     ['caido',      'Sin conexión en vivo'],
  CLOSED:        ['caido',      'Desconectado'],
  demo:          ['demo',       'Datos de demostración']
};

/** El punto de color del encabezado. Un plano que dejo de actualizarse se ve
 *  exactamente igual que uno donde no paso nada: sin este indicador no hay
 *  forma de distinguir "todo tranquilo" de "se cayo el socket". */
function mostrarConexion(estado) {
  const [clase, texto] = TEXTO_CONEXION[estado] ?? ['conectando', 'Conectando…'];
  const nodo = document.getElementById('conexion');

  nodo.dataset.estado = clase;
  nodo.textContent = texto;
}

/** Busca una plaza por id en todos los niveles. Devuelve tambien el nivel
 *  porque un cambio de estado obliga a repintar el contador de libres de ese
 *  nivel, no solo el rectangulo. */
function ubicarPlaza(plazaId) {
  for (const datos of niveles) {
    const plaza = datos.plazas.find((item) => item.id === plazaId);
    if (plaza) return { datos, plaza };
  }
  return null;
}

/** Parpadeo de un segundo sobre la plaza que acaba de cambiar. En un plano de
 *  treinta rectangulos, un cambio de color remoto pasa desapercibido. */
function destacar(grupo) {
  grupo.classList.remove('destacada');

  // Fuerza un reflow. Sin esto, quitar y volver a poner la clase en el mismo
  // frame no reinicia la animacion: el navegador ve el estado final identico al
  // inicial y no vuelve a animar.
  void grupo.getBoundingClientRect();

  grupo.addEventListener('animationend',
    () => grupo.classList.remove('destacada'), { once: true });
  grupo.classList.add('destacada');
}

function repintarPlaza(plaza) {
  const grupo = document.querySelector(`#plano [data-plaza-id="${plaza.id}"]`);
  if (!grupo) return;   // la plaza es de otro nivel: no esta dibujada

  // classList y no className: en SVG className es un SVGAnimatedString de solo
  // lectura. Y se togglean solo las clases de estado en vez de reescribir el
  // atributo entero, porque el <g> puede tener ademas 'seleccionada'.
  ORDEN_ESTADOS.forEach((estado) => {
    grupo.classList.toggle(`estado-${estado}`, estado === plaza.estado);
  });

  grupo.setAttribute('aria-label',
    `Plaza ${plaza.codigo}, ${ETIQUETA_TIPO[plaza.tipo]}, ${ETIQUETA_ESTADO[plaza.estado]}`);

  destacar(grupo);

  // Si es la plaza abierta en el panel, su detalle quedo viejo.
  if (grupo === plazaSeleccionada) mostrarDetalle(plaza);
}

function repintarMini(plaza) {
  const rect = document.querySelector(`#lista-niveles [data-plaza-id="${plaza.id}"]`);
  if (!rect) return;

  ORDEN_ESTADOS.forEach((estado) => {
    rect.classList.toggle(`estado-${estado}`, estado === plaza.estado);
  });
}

/** El contador de libres del boton de un nivel. Es lo unico del selector que no
 *  se repinta solo: los rectangulos los actualiza repintarMini. */
function actualizarLibres(datos) {
  const boton = document.querySelector(
    `#lista-niveles .nivel[data-nivel-id="${datos.nivel.id}"]`);
  if (!boton) return;

  const libres = contarLibres(datos.plazas);

  boton.querySelector('.libres').textContent =
    `${libres} ${libres === 1 ? 'libre' : 'libres'}`;
  boton.setAttribute('aria-label', `${datos.nivel.nombre}, ${libres} plazas libres`);
}

/**
 * Aplica un cambio llegado por el canal.
 *
 * Repinta solo lo que cambio en vez de volver a dibujar el plano. Redibujar
 * seria mas corto, pero destruiria el <g> que tiene el foco del teclado: a
 * quien esta navegando con Tab se le perderia el foco cada vez que otra persona
 * toca un estado en el panel. Tambien se perderia la plaza seleccionada.
 */
function aplicarCambio(plazaNueva) {
  // Number() por las dudas: el id viaja por el canal y no vale la pena depender
  // de que llegue como numero y no como texto.
  const ubicada = ubicarPlaza(Number(plazaNueva.id));

  // Una plaza que no estaba cargada al abrir la pagina no se arregla
  // parcheando: la resuelve la proxima recarga.
  if (!ubicada) return;

  const { datos, plaza } = ubicada;

  // Un evento puede llegar despues de una lectura que ya traia este cambio, o
  // desordenado respecto de otro evento de la misma plaza. Sin esta guarda, un
  // mensaje viejo pisa uno nuevo y el plano queda mintiendo.
  if (aFecha(plazaNueva.actualizado_en) < aFecha(plaza.actualizado_en)) return;

  // Se MUTA el objeto en lugar de reemplazarlo: dibujarPlaza guardo una
  // referencia a este mismo objeto adentro del listener del clic. Si se
  // cambiara por otro, el plano se repintaria bien pero el detalle seguiria
  // mostrando los datos viejos.
  Object.assign(plaza, plazaNueva);

  repintarMini(plaza);
  actualizarLibres(datos);

  if (datos.nivel.id === nivelActual) {
    repintarPlaza(plaza);
    actualizarResumen(datos.plazas);
  }
}

function cambiarNivel(nivelId) {
  if (nivelId === nivelActual) return;

  const datos = niveles.find((item) => item.nivel.id === nivelId);
  if (!datos) return;

  nivelActual = nivelId;

  document.getElementById('nombre-nivel').textContent =
    `${datos.nivel.estacionamiento ?? 'Estacionamiento'} — ${datos.nivel.nombre}`;

  // La plaza elegida pertenecia al nivel anterior: dejar su detalle abierto
  // mostraria datos de una plaza que ya no esta en pantalla.
  limpiarDetalle();
  dibujarPlano(datos);
  actualizarResumen(datos.plazas);
  marcarNivelActivo(nivelId);
}

function mostrarError(mensaje) {
  const aviso = document.createElement('p');
  aviso.className = 'error';
  aviso.textContent = mensaje;
  document.getElementById('plano').replaceChildren(aviso);
}

async function cargarNiveles() {
  const lista = await API.obtenerNiveles();
  if (lista.length === 0) throw new Error('el estacionamiento no tiene niveles cargados');

  // Se cargan todos los niveles de una: los planos chicos los necesitan.
  // En modo demo es un solo fetch igual, porque el archivo esta cacheado.
  niveles = await Promise.all(lista.map(async (nivel) => ({
    nivel,
    plazas: await API.obtenerPlazas(nivel.id),
    referencias: await API.obtenerReferencias(nivel.id)
  })));
}

/**
 * Relectura completa despues de una caida del canal.
 *
 * Realtime no reenvia lo que uno se perdio mientras estuvo desconectado, asi
 * que la unica forma de volver a estar seguro es preguntar de nuevo. Se
 * conserva el nivel que se estaba mirando; la plaza seleccionada se pierde
 * porque el <g> se recrea, y eso es preferible a dejar abierto un detalle que
 * ya no se sabe si es cierto.
 */
async function resincronizar() {
  const nivelPrevio = nivelActual;

  try {
    await cargarNiveles();
  } catch (error) {
    mostrarError(`Se perdio la conexion y no se pudo recargar: ${error.message}`);
    return;
  }

  dibujarSelectorNiveles();

  // cambiarNivel corta si el nivel es el mismo que ya estaba: hay que
  // desarmarlo a mano para que vuelva a dibujar.
  nivelActual = null;

  const sigueExistiendo = niveles.some((datos) => datos.nivel.id === nivelPrevio);
  cambiarNivel(sigueExistiendo ? nivelPrevio : niveles[0].nivel.id);
}

async function iniciar() {
  try {
    await cargarNiveles();
  } catch (error) {
    mostrarError(`No se pudo cargar el plano: ${error.message}`);
    return;
  }

  dibujarSelectorNiveles();
  cambiarNivel(niveles[0].nivel.id);   // el primero por 'orden': la planta baja

  // Recien despues de dibujar: si el canal se abriera antes, un cambio que
  // llegara durante la carga no encontraria la plaza en 'niveles' y se
  // descartaria. Queda una ventana de unos milisegundos entre la lectura y la
  // suscripcion; lo que la cierra de verdad es la resincronizacion, porque el
  // riesgo real no es esa ventana sino un corte de red de un minuto.
  API.suscribirsePlazas({
    alCambiar: aplicarCambio,
    alReconectar: resincronizar,
    alEstado: mostrarConexion
  });
}

iniciar();
