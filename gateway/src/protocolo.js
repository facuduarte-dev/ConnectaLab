// Traduce una linea del protocolo serie (README 7.4) a un objeto, o devuelve
// null si la linea no se entiende.
//
// Formato:  TIPO;clave=valor;clave=valor
// Ejemplos: LISTO;plaza=3
//           EVENTO;plaza=3;estado=ocupado;distancia=87
//           PING;plaza=3;estado=libre;distancia=229
//           DIST;plaza=3;distancia=143

const TIPOS = ['LISTO', 'EVENTO', 'PING', 'DIST'];
const ESTADOS = ['libre', 'ocupado', 'reservado', 'sin_datos'];

export function parsearLinea(linea) {
  const limpia = String(linea).trim();
  if (limpia === '') return null;

  const partes = limpia.split(';');
  const tipo = partes[0];

  // El prefijo va primero justamente para poder descartar de un vistazo.
  if (!TIPOS.includes(tipo)) return null;

  const campos = {};
  for (const parte of partes.slice(1)) {
    const corte = parte.indexOf('=');
    if (corte === -1) return null;
    campos[parte.slice(0, corte)] = parte.slice(corte + 1);
  }

  const plazaId = Number(campos.plaza);
  if (!Number.isInteger(plazaId)) return null;

  // LISTO avisa que la placa arranco y DIST es para calibrar a ojo: ninguno
  // de los dos describe un estado, asi que no se reportan.
  if (tipo === 'LISTO' || tipo === 'DIST') {
    return { tipo, plazaId, reporta: false };
  }

  const estado = campos.estado;
  if (!ESTADOS.includes(estado)) return null;

  return { tipo, plazaId, estado, distancia: Number(campos.distancia), reporta: true };
}