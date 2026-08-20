// Genera un token nuevo para un sensor o camara, y muestra el token en claro
// (para grabarlo UNA VEZ en el firmware) junto con su hash (para guardar en
// la tabla "dispositivos"). El token en claro no se guarda en ningun lado
// despues de este paso: si se pierde, hay que generar uno nuevo.
//
// Uso:
//   node scripts/crear_token_dispositivo.js
import { randomBytes } from 'node:crypto';
import { sha256 } from '../src/lib/hash.js';

const token = randomBytes(32).toString('hex');
const tokenHash = sha256(token);

console.log('Token en claro (copialo al firmware del dispositivo, no se vuelve a mostrar):');
console.log(token);
console.log('\ntoken_hash (esto es lo que va en la columna token_hash de la tabla dispositivos):');
console.log(tokenHash);
