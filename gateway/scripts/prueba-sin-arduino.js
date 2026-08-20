// Prueba el camino puente -> API sin tocar el hardware. Le pasas una linea del
// protocolo por argumento y hace exactamente lo que haria con el Arduino.
//
//   npm run prueba
//   npm run prueba -- "EVENTO;plaza=3;estado=libre;distancia=231"
import { parsearLinea } from '../src/protocolo.js';
import { reportarEvento } from '../src/api.js';

const linea = process.argv[2] ?? 'EVENTO;plaza=3;estado=ocupado;distancia=87';

console.log('linea    :', JSON.stringify(linea));
const mensaje = parsearLinea(linea);
console.log('parseada :', mensaje);

if (!mensaje) {
  console.log('resultado: la linea no se entiende, no se reporta nada');
} else if (!mensaje.reporta) {
  console.log('resultado: es informativa, no se reporta');
} else {
  console.log('resultado:', await reportarEvento(mensaje));
}