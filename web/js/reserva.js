import { supabase } from './supabase.js';
import { API } from './api.js';

/**
 * Modal de reserva.
 *
 * El panel de detalle informa; este modal decide. Se abre desde el boton
 * "Reservar esta plaza" y hace tres cosas: confirmar cual es la plaza, exigir
 * sesion iniciada, y mandar el cambio de estado.
 *
 * Se apoya en PATCH /api/plazas/:id, el mismo endpoint que usa el panel de
 * administracion. Eso trae una limitacion que conviene tener presente: la base
 * guarda que la plaza quedo 'reservado', pero no QUIEN la reservo. Cualquier
 * sesion valida puede reservar, y tambien liberar la de otro. Resolverlo de
 * verdad pide una tabla 'reservas' con usuario y vencimiento, que es trabajo
 * de backend.
 */

const modal    = document.getElementById('modal-reserva');
const elTitulo = document.getElementById('modal-titulo');
const elDonde  = document.getElementById('modal-donde');
const elAccion = document.getElementById('modal-accion');

let plazaActual = null;
let nivelActual = null;

// Cada vez que se vuelve a pintar la accion se toma un numero. Adentro hay un
// await —la consulta de la sesion— y en ese rato la persona pudo haber
// cerrado el modal y abierto otro. Sin este contador, la respuesta lenta de la
// primera llamada dibujaria sus botones sobre la plaza equivocada.
let turno = 0;

export function abrirReserva(plaza, nivel) {
  plazaActual = plaza;
  nivelActual = nivel;

  elTitulo.textContent = `Reservar plaza ${plaza.codigo}`;
  elDonde.textContent  = nivel ? nivel.nombre : '';

  pintarAccion();
  modal.showModal();   // showModal y no show: show() no atrapa el foco ni
                       // dibuja el ::backdrop, y el fondo queda navegable
}

/**
 * Un cambio llegado por el canal mientras el modal esta abierto.
 *
 * El caso que importa es el unico que puede pasar de verdad: entre que se
 * abrio el modal y se toco Confirmar, otra persona tomo la plaza. Dejar el
 * boton habilitado ahi seria mandar al usuario a un error evitable.
 */
export function refrescarReserva(plazaNueva) {
  if (!modal.open || plazaActual?.id !== plazaNueva.id) return;
  if (plazaActual.estado === plazaNueva.estado) return;

  plazaActual = plazaNueva;

  if (plazaNueva.estado !== 'libre') {
    elAccion.replaceChildren(
      aviso('Alguien tomó esta plaza recién. Elegí otra del plano.', 'error'),
      soloCerrar()
    );
    return;
  }

  pintarAccion();
}

// Tocar fuera cierra. El clic sobre el fondo tiene como blanco el propio
// <dialog>, porque el ::backdrop no es un elemento del documento. Por eso el
// contenido va dentro de .modal-cuerpo: sin ese envoltorio, un clic en el
// borde del modal se leeria como clic afuera.
modal.addEventListener('click', (evento) => {
  if (evento.target === modal) modal.close();
});

// --- pintado ------------------------------------------------------------

async function pintarAccion() {
  const mio = ++turno;
  elAccion.replaceChildren();

  // getSession lee la sesion guardada en el navegador y no pega contra el
  // servidor, asi que responde rapido; aun asi es asincrono.
  const { data: { session } } = await supabase.auth.getSession();
  if (mio !== turno) return;

  // Sin sesion no hay reserva posible, y no hay camino alternativo: el boton
  // de confirmar ni siquiera se dibuja hasta que haya sesion. La verificacion
  // de verdad igual la hace el backend —autenticarUsuario rechaza el PATCH sin
  // token valido—; esto es la mitad de la puerta que se ve.
  elAccion.replaceChildren(session ? confirmacion(session) : formularioLogin());
}

function aviso(texto, clase) {
  const parrafo = document.createElement('p');
  parrafo.className = clase;
  parrafo.textContent = texto;
  return parrafo;
}

function botonCancelar(texto = 'Cancelar') {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton-secundario';
  boton.textContent = texto;
  boton.addEventListener('click', () => modal.close());
  return boton;
}

function soloCerrar() {
  const fila = document.createElement('div');
  fila.className = 'modal-acciones';
  fila.append(botonCancelar('Cerrar'));
  return fila;
}

// --- confirmar ----------------------------------------------------------

function confirmacion(session) {
  const bloque = document.createElement('div');

  // Quien esta reservando, a la vista. Es la unica forma de que se note que la
  // sesion fue exigida: si el modal saltara directo a "Confirmar", no habria
  // diferencia visible entre haber iniciado sesion y no.
  const quien = document.createElement('p');
  quien.className = 'sesion';
  quien.textContent = `Sesión iniciada como ${session.user.email}`;

  bloque.append(quien, aviso(
    'La plaza va a quedar marcada como reservada para el resto de los usuarios.',
    'aclaracion'
  ));

  const confirmar = document.createElement('button');
  confirmar.type = 'button';
  confirmar.className = 'boton boton-primario';
  confirmar.textContent = 'Confirmar reserva';
  confirmar.addEventListener('click', () => reservar(confirmar));

  const fila = document.createElement('div');
  fila.className = 'modal-acciones';
  fila.append(botonCancelar(), confirmar);

  bloque.append(fila);
  return bloque;
}

async function reservar(boton) {
  const plaza = plazaActual;

  boton.disabled = true;
  boton.textContent = 'Reservando…';

  try {
    // El token se pide recien ahora y no se guarda en una variable: si la
    // sesion vencio mientras la pagina estaba abierta, queremos enterarnos
    // aca y no mandar un token muerto.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('la sesión venció, volvé a entrar');

    const actualizada = await API.cambiarEstado(plaza.id, 'reservado', session.access_token);

    // Se MUTA el objeto y no se reemplaza: plano.js guardo una referencia a
    // este mismo objeto dentro del listener del clic de la plaza. Cambiarlo
    // por otro dejaria el detalle mostrando los datos viejos.
    Object.assign(plaza, actualizada);

    elAccion.replaceChildren(
      aviso(`Listo. La plaza ${plaza.codigo} quedó reservada${nivelActual ? ` en ${nivelActual.nombre}` : ''}.`, 'exito'),
      soloCerrar()
    );
  } catch (error) {
    boton.disabled = false;
    boton.textContent = 'Confirmar reserva';
    elAccion.prepend(aviso(`No se pudo reservar: ${error.message}`, 'error'));
  }
}

// --- sesion -------------------------------------------------------------

/**
 * El login va DENTRO del modal y no en otra pantalla.
 *
 * Mandarlo a una pagina aparte obliga a volver y a buscar de nuevo la plaza
 * que se estaba mirando, que para ese momento puede haberse ocupado. Aca se
 * entra y el boton de confirmar aparece en el mismo lugar.
 */
function formularioLogin() {
  const form = document.createElement('form');

  // Marcado fijo, sin ningun dato que venga del servidor: no hay superficie de
  // inyeccion. Todo lo que sale de la base va por textContent.
  form.innerHTML = `
    <p class="aclaracion">Para reservar hay que iniciar sesión.
       Es la misma cuenta del panel de administración.</p>
    <label class="campo">Correo
      <input type="email" name="correo" required autocomplete="username"
             inputmode="email" autocapitalize="none">
    </label>
    <label class="campo">Contraseña
      <input type="password" name="clave" required autocomplete="current-password">
    </label>
  `;

  const entrar = document.createElement('button');
  entrar.type = 'submit';
  entrar.className = 'boton boton-primario';
  entrar.textContent = 'Entrar';

  const fila = document.createElement('div');
  fila.className = 'modal-acciones';
  fila.append(botonCancelar(), entrar);
  form.append(fila);

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    form.querySelector('.error')?.remove();
    entrar.disabled = true;
    entrar.textContent = 'Entrando…';

    const { error } = await supabase.auth.signInWithPassword({
      email:    form.correo.value,
      password: form.clave.value
    });

    if (error) {
      entrar.disabled = false;
      entrar.textContent = 'Entrar';
      form.prepend(aviso(`No se pudo entrar: ${error.message}`, 'error'));
      return;
    }

    // Con sesion abierta, la accion se recalcula sola y el formulario da paso
    // a la confirmacion.
    pintarAccion();
  });

  return form;
}
