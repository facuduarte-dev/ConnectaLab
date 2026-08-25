package com.parkex.ocr;
import java.util.regex.Pattern;

/**
 * El distintivo de discapacidad de la chapa.
 *
 * Reemplaza al padron de vehiculos autorizados, y lo hace por el mismo motivo
 * que el README 2.2 da para desconfiar de ese padron: el permiso es de la
 * persona, no del vehiculo. Un padron propio del parking era una copia parcial
 * y siempre desactualizada de algo que la chapa ya dice por si sola.
 *
 * La comprobacion vive ACA, en el lector, y no en el backend. No es comodidad:
 * el backend solo recibe el HMAC de la matricula (README 6) y un hash no
 * conserva el texto. Este es el ultimo punto del recorrido donde todavia se
 * puede mirar si la chapa lleva el distintivo.
 */
public final class Distintivo {
    // El bloque de letras termina en DI: IDI 1483, ADI 4021. Se aplica sobre la
    // matricula YA normalizada, asi que llega sin espacios ni guiones y con las
    // confusiones de OCR corregidas por posicion (una O que en el bloque de
    // letras es una O, y en el de digitos un 0).
    private static final Pattern CON_DISTINTIVO = Pattern.compile("^[A-Z]DI[0-9]{4}$");

    private Distintivo() { }

    public static boolean presente(String matriculaNormalizada) {
        return matriculaNormalizada != null && CON_DISTINTIVO.matcher(matriculaNormalizada).matches();
    }
}
