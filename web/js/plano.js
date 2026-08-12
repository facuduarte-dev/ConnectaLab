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
    // tabindex y role: la plaza se puede elegir con el teclado, no solo con el
    // mouse. Un <g> sin esto es invisible para quien navega con Tab.
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

  const filas = [
    ['Tipo', ETIQUETA_TIPO[plaza.tipo]],
    ['Estado', ETIQUETA_ESTADO[plaza.estado]]
  ];

  // La autorizacion solo tiene sentido en plazas de discapacidad; en el resto
  // el valor es siempre 'no_aplica' y mostrarlo confunde.
  if (plaza.tipo === 'discapacidad') {
    filas.push(['Autorización', ETIQUETA_AUTORIZACION[plaza.autorizacion]]);
  }

  filas.push(['Actualizado', new Date(plaza.actualizado_en).toLocaleString('es-UY')]);

  const detalle = document.getElementById('detalle');
  detalle.innerHTML = `
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

async function iniciar() {
  try {
    const lista = await API.obtenerNiveles();
    if (lista.length === 0) throw new Error('el estacionamiento no tiene niveles cargados');

    // Se cargan todos los niveles de una: los planos chicos los necesitan.
    // En modo demo es un solo fetch igual, porque el archivo esta cacheado.
    niveles = await Promise.all(lista.map(async (nivel) => ({
      nivel,
      plazas: await API.obtenerPlazas(nivel.id),
      referencias: await API.obtenerReferencias(nivel.id)
    })));
  } catch (error) {
    mostrarError(`No se pudo cargar el plano: ${error.message}`);
    return;
  }

  dibujarSelectorNiveles();
  cambiarNivel(niveles[0].nivel.id);   // el primero por 'orden': la planta baja
}

iniciar();
