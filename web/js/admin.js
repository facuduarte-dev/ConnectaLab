import { supabase } from './supabase.js';
import { API } from './api.js';

// Fila de la tabla por id de plaza, para poder actualizarla cuando el cambio lo
// hizo otra persona. Se rearma entera en cada carga del panel.
const filasPorPlaza = new Map();

// Se guarda para poder cortar el canal al cerrar sesion y para no suscribirse
// dos veces si mostrarPanel() se llama de nuevo.
let cortarCanal = null;

const ESTADOS = ['libre', 'ocupado', 'reservado', 'sin_datos'];

const ETIQUETA_ESTADO = {
  libre: 'Libre', ocupado: 'Ocupado',
  reservado: 'Reservado', sin_datos: 'Sin datos'
};

const ETIQUETA_TIPO = {
  normal: 'Normal', discapacidad: 'Discapacidad',
  carga: 'Carga', moto: 'Moto'
};

const seccionLogin = document.getElementById('login');
const seccionPanel = document.getElementById('panel');
const botonSalir = document.getElementById('salir');
const aviso = document.getElementById('aviso');

function avisar(texto, esError = false) {
  aviso.textContent = texto;
  aviso.className = esError ? 'error' : 'ok';
}

// --- sesion -------------------------------------------------------------

document.getElementById('form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const errorLogin = document.getElementById('error-login');
  errorLogin.hidden = true;

  const { error } = await supabase.auth.signInWithPassword({
    email: document.getElementById('email').value,
    password: document.getElementById('password').value
  });

    if (error) {
    console.error(error);
    errorLogin.textContent = `No se pudo entrar: ${error.message}`;
    errorLogin.hidden = false;
    return;
  }

  mostrarPanel();
});

botonSalir.addEventListener('click', async () => {
  cortarCanal?.();
  cortarCanal = null;

  await supabase.auth.signOut();
  seccionPanel.hidden = true;
  botonSalir.hidden = true;
  seccionLogin.hidden = false;
});

// --- panel --------------------------------------------------------------

async function mostrarPanel() {
  seccionLogin.hidden = true;
  seccionPanel.hidden = false;
  botonSalir.hidden = false;

  filasPorPlaza.clear();

  try {
    const niveles = await API.obtenerNiveles();
    const filas = [];
    const pisos = [];

    for (const nivel of niveles) {
      const plazas = await API.obtenerPlazas(nivel.id);
      plazas.forEach((plaza) => filas.push({ nivel, plaza }));
      pisos.push({ nivel, cantidad: plazas.length });
    }

    dibujarPisos(pisos);

    document.querySelector('#tabla-plazas tbody')
      .replaceChildren(...filas.map(construirFila));

    avisar(`${niveles.length} pisos, ${filas.length} plazas.`);
  } catch (error) {
    avisar(`No se pudieron cargar las plazas: ${error.message}`, true);
    return;
  }

  // Una sola vez: mostrarPanel se vuelve a llamar al resincronizar y al crear
  // un piso, y no hay que abrir un canal nuevo cada vez.
  cortarCanal ??= API.suscribirsePlazas({
    alCambiar: reflejarCambio,
    alReconectar: mostrarPanel
  });
}

/**
 * Un cambio hecho desde otro lado: otra persona en otro panel, o —desde la fase
 * 6— el sensor de la plaza. Si el panel no escuchara, dos administradores
 * trabajando a la vez se pisarian sin enterarse.
 */
function reflejarCambio(plazaNueva) {
  const fila = filasPorPlaza.get(Number(plazaNueva.id));
  if (!fila) return;

  Object.assign(fila.plaza, plazaNueva);

  // El selector deshabilitado significa que hay un cambio propio en vuelo.
  // Pisarlo ahora seria pelearle al usuario; cuando el PATCH termine, el valor
  // va a coincidir igual.
  if (fila.selector.disabled) return;

  fila.selector.value = plazaNueva.estado;
  fila.celdaAutorizacion.textContent = plazaNueva.autorizacion;
}

function construirFila({ nivel, plaza }) {
  const fila = document.createElement('tr');

  const celda = (texto) => {
    const td = document.createElement('td');
    td.textContent = texto;
    return td;
  };

  const selector = document.createElement('select');
  selector.setAttribute('aria-label', `Estado de la plaza ${plaza.codigo}`);

  ESTADOS.forEach((estado) => {
    const opcion = document.createElement('option');
    opcion.value = estado;
    opcion.textContent = ETIQUETA_ESTADO[estado];
    opcion.selected = estado === plaza.estado;
    selector.append(opcion);
  });

  // El token se pide en cada cambio y no se guarda en una variable: si la
  // sesion vencio mientras la pagina estaba abierta, queremos enterarnos aca
  // y no mandar un token muerto.
  selector.addEventListener('change', async () => {
    const anterior = plaza.estado;
    selector.disabled = true;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('la sesión venció, volvé a entrar');

      const actualizada = await API.cambiarEstado(
        plaza.id, selector.value, session.access_token
      );

      plaza.estado = actualizada.estado;
      fila.children[3].textContent = actualizada.autorizacion;
      avisar(`Plaza ${plaza.codigo} → ${ETIQUETA_ESTADO[actualizada.estado]}`);
    } catch (error) {
      // Volver el selector a lo que la base tiene de verdad: dejarlo en el
      // valor elegido mostraria un cambio que no ocurrio.
      selector.value = anterior;
      avisar(`No se pudo cambiar ${plaza.codigo}: ${error.message}`, true);
    } finally {
      selector.disabled = false;
    }
  });

  const celdaEstado = document.createElement('td');
  celdaEstado.append(selector);

  fila.append(
    celda(nivel.nombre),
    celda(plaza.codigo),
    celda(ETIQUETA_TIPO[plaza.tipo]),
    celda(plaza.autorizacion),
    celdaEstado
  );
  filasPorPlaza.set(plaza.id, { plaza, selector, celdaAutorizacion: fila.children[3] });

  return fila;
}

// --- pisos --------------------------------------------------------------

const formNivel  = document.getElementById('form-nivel');
const vistaNivel = document.getElementById('nivel-vista');

/**
 * Como va a quedar repartido el piso.
 *
 * Es una division y nada mas. Las coordenadas y el tamano del plano NO se
 * calculan aca a proposito: ese calculo vive en el backend, y duplicarlo para
 * una vista previa seria garantizar que algun dia las dos versiones difieran y
 * el panel prometa una cosa mientras la API crea otra.
 */
function actualizarVista() {
  const cantidad = Number(document.getElementById('nivel-cantidad').value);
  const porFila  = Number(document.getElementById('nivel-por-fila').value);

  if (!cantidad || !porFila) {
    vistaNivel.textContent = '';
    return;
  }

  const filas  = Math.ceil(cantidad / porFila);
  const ultima = cantidad % porFila;

  if (filas === 1) {
    vistaNivel.textContent = `Va a quedar 1 fila de ${cantidad} plazas.`;
    return;
  }

  vistaNivel.textContent = ultima === 0
    ? `Van a quedar ${filas} filas de ${porFila} plazas.`
    : `Van a quedar ${filas - 1} filas de ${porFila} y una última de ${ultima}.`;
}

formNivel.addEventListener('input', actualizarVista);
actualizarVista();

formNivel.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const boton = formNivel.querySelector('button');
  boton.disabled = true;

  try {
    // El token se pide en el momento y no se guarda: si la sesion vencio con
    // la pagina abierta, queremos enterarnos aca.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('la sesión venció, volvé a entrar');

    // Number() explicito: el valor de un <input type="number"> es un string, y
    // la API valida con Number.isInteger, que rechazaria "24".
    const nivel = await API.crearNivel({
      nombre:   document.getElementById('nivel-nombre').value,
      cantidad: Number(document.getElementById('nivel-cantidad').value),
      porFila:  Number(document.getElementById('nivel-por-fila').value)
    }, session.access_token);

    formNivel.reset();
    actualizarVista();
    await mostrarPanel();

    // Despues de mostrarPanel, que pisa el aviso con su propio recuento.
    avisar(`Piso "${nivel.nombre}" creado con ${nivel.plazas_creadas} plazas.`);
  } catch (error) {
    avisar(`No se pudo crear el piso: ${error.message}`, true);
  } finally {
    boton.disabled = false;
  }
});

function dibujarPisos(pisos) {
  const lista = document.getElementById('lista-pisos');

  lista.replaceChildren(...pisos.map(({ nivel, cantidad }) => {
    const item = document.createElement('li');

    const texto = document.createElement('span');
    texto.textContent = `${nivel.nombre} — ${cantidad} ${cantidad === 1 ? 'plaza' : 'plazas'}`;

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'borrar';
    borrar.textContent = 'Eliminar';
    borrar.addEventListener('click', () => eliminarPiso(nivel, borrar));

    item.append(texto, borrar);
    return item;
  }));
}

async function eliminarPiso(nivel, boton) {
  // confirm() es feo, y es exactamente lo que corresponde: una accion
  // destructiva que no se puede deshacer necesita un segundo acto deliberado,
  // no un clic que se puede dar sin querer al scrollear.
  if (!window.confirm(`¿Eliminar el piso "${nivel.nombre}" y todas sus plazas?`)) return;

  boton.disabled = true;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('la sesión venció, volvé a entrar');

    await API.borrarNivel(nivel.id, session.access_token);
    await mostrarPanel();
    avisar(`Piso "${nivel.nombre}" eliminado.`);
  } catch (error) {
    boton.disabled = false;
    avisar(`No se pudo eliminar: ${error.message}`, true);
  }
}

// Si ya habia sesion abierta, saltear el login.
const { data: { session } } = await supabase.auth.getSession();
if (session) mostrarPanel();