// Hash SHA-256 simple para tokens de dispositivo (ESP32 y camaras).
// Ojo: esto es DISTINTO del HMAC-SHA256 de matriculas de la seccion 6 del
// README. Ese HMAC lo calcula el servicio de lectura (seccion 8/9), con una
// clave secreta propia, y el backend solo compara hashes que ya le llegan
// calculados. Este archivo es solo para no guardar tokens de dispositivo en
// texto plano en la tabla "dispositivos".
import { createHash } from 'node:crypto';

export function sha256(texto) {
  return createHash('sha256').update(texto).digest('hex');
}
