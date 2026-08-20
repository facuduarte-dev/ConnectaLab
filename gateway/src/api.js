import 'dotenv/config';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const TOKEN = process.env.TOKEN_DISPOSITIVO;
const CONFIANZA = Number(process.env.CONFIANZA_SENSOR ?? 0.8);

const INTENTOS = 5;
const ESPERA_INICIAL_MS = 1000;

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

export async function reportarEvento({ plazaId, estado }) {
  if (!TOKEN) {
    return { ok: false, permanente: true, detalle: 'Falta TOKEN_DISPOSITIVO en gateway/.env' };
  }

  const cuerpo = JSON.stringify({
    plaza_id: plazaId,
    estado,
    fuente: 'sensor',
    confianza: CONFIANZA,
  });

  let espera = ESPERA_INICIAL_MS;

  for (let intento = 1; intento <= INTENTOS; intento++) {
    let motivo;

    try {
      const respuesta = await fetch(`${API_URL}/api/eventos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: cuerpo,
      });

      if (respuesta.ok) return { ok: true };

      const detalle = await respuesta.text();

      // 4xx = el pedido esta mal y va a estar mal siempre: token invalido,
      // plaza inexistente, estado mal escrito. Reintentar no lo arregla, y
      // ademas esconde el error real detras de medio minuto de intentos.
      if (respuesta.status >= 400 && respuesta.status < 500) {
        return { ok: false, permanente: true, detalle: `HTTP ${respuesta.status} ${detalle}` };
      }

      // 5xx si se reintenta: al servidor se le puede pasar.
      motivo = `HTTP ${respuesta.status} ${detalle}`;
    } catch (error) {
      // La API no esta levantada, se corto la red, no resuelve el nombre...
      motivo = error.message;
    }

    if (intento === INTENTOS) {
      return { ok: false, permanente: false, detalle: motivo };
    }

    console.warn(`   reintento ${intento}/${INTENTOS - 1} en ${espera / 1000}s — ${motivo}`);
    await dormir(espera);
    espera *= 2;   // 1s, 2s, 4s, 8s: espera creciente (README 7.5, punto 4)
  }
}