/**
 * Geometria de un nivel a partir de cuantas plazas tiene y cuantas van por fila.
 *
 * Vive en el backend y no en el panel, y esa es la decision de diseno de este
 * archivo. Si el navegador mandara las coordenadas ya calculadas, la API
 * estaria confiando en que el cliente sabe dibujar un parking, y cualquier otro
 * cliente —un script de migracion, otro panel, una app— tendria que
 * reimplementar lo mismo. Las dos versiones se irian separando sin que nadie se
 * entere. La API recibe INTENCION ("24 plazas, 8 por fila") y decide la forma.
 */

// Todas en unidades del plano: el mismo sistema de coordenadas del viewBox del
// SVG. Coinciden con los valores por defecto de la tabla plazas para que un
// piso generado se vea igual que los que se cargaron a mano.
const ANCHO_PLAZA = 40;
const ALTO_PLAZA  = 80;
const SEPARACION  = 8;    // entre plazas contiguas de la misma fila
const CARRIL      = 90;   // entre filas: por ahi pasa el auto
const MARGEN      = 40;   // borde del plano

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const MAXIMO_FILAS = LETRAS.length;

export function generarPlano(cantidad, porFila) {
  // Si se piden menos plazas que el ancho de fila, la fila es mas corta y el
  // plano tambien: sin este min, un piso de 3 plazas con 8 por fila quedaria
  // con el ancho de 8 y cinco huecos vacios a la derecha.
  const columnas = Math.min(porFila, cantidad);
  const filas    = Math.ceil(cantidad / porFila);

  const plazas = [];

  for (let indice = 0; indice < cantidad; indice++) {
    const fila    = Math.floor(indice / porFila);
    const columna = indice % porFila;

    plazas.push({
      // A01, A02… B01, B02… Es el mismo formato que usan los pisos cargados a
      // mano, y el padStart es lo que hace que A02 y A10 se ordenen bien:
      // 'order by codigo' en la API es alfabetico, y sin el cero A10 iria antes
      // que A2.
      codigo: `${LETRAS[fila]}${String(columna + 1).padStart(2, '0')}`,
      x: MARGEN + columna * (ANCHO_PLAZA + SEPARACION),
      y: MARGEN + fila * (ALTO_PLAZA + CARRIL),
      ancho: ANCHO_PLAZA,
      alto: ALTO_PLAZA,
      tipo: 'normal'
    });
  }

  return {
    plazas,

    // El plano mide exactamente lo que ocupan las plazas mas el margen, ni un
    // pixel mas. Dejarlo mas grande "por las dudas" no seria inofensivo: desde
    // el rediseno, los tres niveles comparten una escala calculada contra el
    // mas ancho, asi que un piso con aire vacio a la derecha achicaria las
    // plazas de TODOS los pisos, incluidos los que ya estaban.
    ancho_plano: MARGEN * 2 + columnas * ANCHO_PLAZA + (columnas - 1) * SEPARACION,
    alto_plano:  MARGEN * 2 + filas * ALTO_PLAZA + (filas - 1) * CARRIL
  };
}