import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Publicas por diseno: la anon key no puede hacer nada que las politicas RLS
// no permitan. La service_role NUNCA va en esta carpeta.
const SUPABASE_URL = 'https://wudfiaqlltjrfasiwnnp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1ZGZpYXFsbHRqcmZhc2l3bm5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1Mzk2NDQsImV4cCI6MjEwMjExNTY0NH0.01tG1S7mVEOM1Ans1c6F0QVCrI1t8dpaVK6pOO0kTzE';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

  try {
    const niveles = await API.obtenerNiveles();
    const filas = [];

    for (const nivel of niveles) {
      const plazas = await API.obtenerPlazas(nivel.id);
      plazas.forEach((plaza) => filas.push({ nivel, plaza }));
    }

    document.querySelector('#tabla-plazas tbody')
      .replaceChildren(...filas.map(construirFila));

    avisar(`${filas.length} plazas cargadas.`);
  } catch (error) {
    avisar(`No se pudieron cargar las plazas: ${error.message}`, true);
  }
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

  return fila;
}

// Si ya habia sesion abierta, saltear el login.
const { data: { session } } = await supabase.auth.getSession();
if (session) mostrarPanel();