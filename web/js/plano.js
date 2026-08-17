import { API } from './api.js';
import { abrirReserva, refrescarReserva } from './reserva.js';
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

/**
 * "hace 3 min" en vez de "11/8/2026, 9:27:00".
 *
 * De esa fecha lo unico que importa es si el dato es de recien o de hace tres
 * horas; la fecha completa obliga a hacer la resta mentalmente.
 *
 * El caso negativo no es teorico: si el reloj del servidor esta unos segundos
 * adelantado la resta da negativa, y sin la guarda diria "hace -1 min".
 */
function hace(valor) {
  const fecha = aFecha(valor);
  if (Number.isNaN(fecha.getTime())) return 'sin fecha';

  const minutos = Math.floor((Date.now() - fecha) / 60000);

  if (minutos < 1)  return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;

  return fecha.toLocaleString('es-UY');
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

// --- escala del plano --------------------------------------------------
//
// Todos los niveles se dibujan a la MISMA escala, y esa es toda la idea de
// esta seccion.
//
// Antes cada SVG se estiraba al ancho disponible con width:100%. Como cada
// nivel tiene su propio ancho_plano —580, 580 y 480— la misma plaza de 40x80
// terminaba dibujada a 0.55 px por unidad en la planta baja y a 0.67 en el
// subsuelo 2. Dos tamanos distintos para la misma plaza segun el piso: un
// plano deja de ser un plano si la escala cambia de una hoja a la otra.
//
// La referencia es el nivel mas grande. El mas ancho llena el espacio y los
// demas quedan proporcionalmente mas angostos, que es justo lo que se quiere
// mostrar: el subsuelo 2 ES mas chico.

// Piso de escala, en pixeles de pantalla por unidad del plano. A 1 una plaza
// mide 40x80 px, que es un objetivo comodo para el dedo. Por debajo de esto no
// se achica mas: se deja que el plano scrollee en horizontal, porque una plaza
// de 22 px no se puede tocar manejando.
const ESCALA_MINIMA = 1;

function dimensionesDeReferencia() {
  return {
    ancho: Math.max(...niveles.map((datos) => datos.nivel.ancho_plano)),
    alto:  Math.max(...niveles.map((datos) => datos.nivel.alto_plano))
  };
}

/** Pixeles de pantalla por unidad del plano, unica para todos los niveles. */
function escalaActual() {
  const contenedor = document.getElementById('plano');
  const { ancho, alto } = dimensionesDeReferencia();

  // clientWidth ya descuenta el padding, que es el espacio real para dibujar.
  const anchoDisponible = contenedor.clientWidth;

  // El alto es una estimacion: lo que queda de ventana descontando la barra,
  // el encabezado y la leyenda. No hace falta que sea exacta, solo evita que
  // en una pantalla ancha el plano quede mas alto que la ventana.
  const altoDisponible = window.innerHeight - 240;

  const cabe = Math.min(anchoDisponible / ancho, altoDisponible / alto);

  return Math.max(ESCALA_MINIMA, cabe);
}

/**
 * Fija el tamano en pixeles del SVG dibujado.
 *
 * Va como atributos width/height y no por CSS: el CSS no puede saber cual es
 * el nivel mas ancho de los tres, que es de donde sale la escala compartida.
 */
function ajustarEscala() {
  const svg = document.querySelector('#plano .plano-svg');
  if (!svg) return;

  const escala = escalaActual();
  const [, , ancho, alto] = svg.getAttribute('viewBox').split(' ').map(Number);

  svg.setAttribute('width', Math.round(ancho * escala));
  svg.setAttribute('height', Math.round(alto * escala));
}

// Girar el telefono cambia el ancho disponible y con el la escala. Se ajusta
// el SVG que ya esta dibujado en vez de redibujar el plano: redibujar
// destruiria el <g> que tiene el foco del teclado y la plaza seleccionada.
window.addEventListener('resize', ajustarEscala);

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
  referencias.forEach((item) => svg.append(dibujarReferencia(item)));
  plazas.forEach((plaza) => svg.append(dibujarPlaza(plaza)));

  document.getElementById('plano').replaceChildren(svg);

  // Despues de insertarlo: la escala necesita el ancho real del contenedor, y
  // antes de estar en el documento ese ancho no existe.
  ajustarEscala();
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

  // Mismo problema que en el plano grande, y misma solucion: si cada mini se
  // estirara al 100% del boton, el subsuelo 2 —que es mas angosto— mostraria
  // sus plazas mas grandes que los otros dos y parecerian pisos distintos. El
  // porcentaje respecto del nivel mas ancho deja a los tres en una escala.
  svg.style.width = `${nivel.ancho_plano / dimensionesDeReferencia().ancho * 100}%`;

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

  // En una sola columna el detalle queda debajo del plano, fuera de la
  // pantalla: sin esto, en el telefono tocar una plaza no parece hacer nada.
  if (window.matchMedia('(max-width: 860px)').matches) {
    document.getElementById('detalle')
      .scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
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

  filas.push(['Actualizado', hace(plaza.actualizado_en)]);

  const titulo = document.createElement('h2');
  titulo.textContent = `Plaza ${plaza.codigo}`;

  const lista = document.createElement('dl');

  filas.forEach(([clave, valor]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = clave;
    dd.textContent = valor;
    lista.append(dt, dd);
  });

  const detalle = document.getElementById('detalle');
  detalle.replaceChildren(titulo, lista);

  // Reservar solo tiene sentido sobre una plaza libre. En los demas estados el
  // boton no aparece, en vez de aparecer deshabilitado: un boton apagado deja
  // preguntandose por que, y el estado ya esta escrito dos lineas mas arriba.
  if (plaza.estado !== 'libre') return;

  const nivel = niveles.find((datos) => datos.nivel.id === plaza.nivel_id)?.nivel;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton-primario';
  boton.textContent = 'Reservar esta plaza';
  boton.addEventListener('click', () => abrirReserva(plaza, nivel));

  detalle.append(boton);
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
  SIN_RED:       ['caido',      'Sin red'],
  CONECTANDO:    ['conectando', 'Reconectando…'],
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

  // El modal se protege solo: si esta cerrado o muestra otra plaza no hace
  // nada. Va aca y no en repintarPlaza para que tambien cubra el caso de una
  // plaza de otro nivel.
  refrescarReserva(plaza);

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

  // Solo el nombre del nivel. El del estacionamiento ya esta en la barra, y
  // tomarlo de la base lo traeria de datos_prueba.sql, que sigue diciendo el
  // nombre viejo: una marca escrita en dos lugares se desincroniza sola.
  document.getElementById('nombre-nivel').textContent = datos.nivel.nombre;

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
