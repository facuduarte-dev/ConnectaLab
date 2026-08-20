import 'dotenv/config';
import { SerialPort, ReadlineParser } from 'serialport';
import { parsearLinea } from './protocolo.js';
import { reportarEvento } from './api.js';

const PUERTO = process.env.PUERTO_SERIE;
const BAUDIOS = Number(process.env.BAUDIOS ?? 115200);
const ESPERA_RECONEXION_MS = 5000;

if (!PUERTO) {
  console.error('Falta PUERTO_SERIE en gateway/.env. Corre "npm run puertos" para verlos.');
  process.exit(1);
}

const log = (...args) => console.log(`[${new Date().toLocaleTimeString('es-UY')}]`, ...args);

async function manejarLinea(linea) {
  const mensaje = parsearLinea(linea);

  if (!mensaje) {
    // Un microcontrolador que se reinicia escupe basura en el puerto, y eso
    // no puede convertirse en una peticion (README 7.5, punto 2).
    log(`descartada: ${JSON.stringify(String(linea).trim())}`);
    return;
  }

  if (!mensaje.reporta) {
    log(`${mensaje.tipo} plaza=${mensaje.plazaId} (no se reporta)`);
    return;
  }

  log(`${mensaje.tipo} plaza=${mensaje.plazaId} estado=${mensaje.estado} distancia=${mensaje.distancia}`);

  const resultado = await reportarEvento(mensaje);

  if (resultado.ok) log('   -> API ok');
  else if (resultado.permanente) log(`   -> RECHAZADO, no se reintenta: ${resultado.detalle}`);
  else log(`   -> PERDIDO tras ${5} intentos: ${resultado.detalle}`);
}

function abrirPuerto() {
  log(`abriendo ${PUERTO} a ${BAUDIOS} baudios...`);

  // Una sola reprogramacion por apertura: 'error' y 'close' pueden dispararse
  // los dos por la misma causa, y sin esta bandera quedarian dos puentes
  // levantandose en paralelo sobre el mismo puerto.
  let reprogramado = false;
  const reprogramar = () => {
    if (reprogramado) return;
    reprogramado = true;
    log(`reintento de conexion en ${ESPERA_RECONEXION_MS / 1000}s`);
    setTimeout(abrirPuerto, ESPERA_RECONEXION_MS);
  };

  const puerto = new SerialPort({ path: PUERTO, baudRate: BAUDIOS });
  const lineas = puerto.pipe(new ReadlineParser({ delimiter: '\n' }));

  puerto.on('open', () => log(`conectado a ${PUERTO}`));

  puerto.on('error', (error) => {
    log(`error del puerto: ${error.message}`);
    if (puerto.isOpen) return puerto.close();   // el handler de 'close' se encarga
    reprogramar();
  });

  puerto.on('close', () => {
    log('puerto cerrado');
    reprogramar();
  });

  // Los mensajes se procesan de a uno y en orden de llegada. Sin esta cola, un
  // EVENTO que quedo reintentando podria terminar aplicandose DESPUES de otro
  // posterior, y la plaza quedaria con el estado viejo pisando al nuevo.
  let cola = Promise.resolve();
  lineas.on('data', (linea) => {
    cola = cola
      .then(() => manejarLinea(linea))
      .catch((error) => log(`error inesperado: ${error.message}`));
  });
}

abrirPuerto();