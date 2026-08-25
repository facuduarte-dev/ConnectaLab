package com.parkex.ocr;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DistintivoTest {

    @Test void reconoceElDistintivoAlFinalDelBloqueDeLetras() {
        assertTrue(Distintivo.presente("IDI1483"));   // la chapa de imagenes/matricula_discapacitados.jpeg
        assertTrue(Distintivo.presente("ADI4021"));
    }

    @Test void unaChapaComunNoLoTiene() {
        assertFalse(Distintivo.presente("ABC1234"));
        assertFalse(Distintivo.presente("SBI5856"));
    }

    /**
     * DI tiene que estar al FINAL del bloque de letras. Aceptar "DI" en
     * cualquier posicion daria por autorizada una chapa comun que empiece con
     * esas letras, y cada una de esas es una plaza reservada ocupada sin que
     * nadie se entere.
     */
    @Test void noAlcanzaConQueLasLetrasContenganDi() {
        assertFalse(Distintivo.presente("DIA1234"));
        assertFalse(Distintivo.presente("DIB0007"));
    }

    /**
     * Sin lectura no hay distintivo que mirar. Devolver false aca convertiria
     * cada foto borrosa en una infraccion, que es justo lo que no_verificable
     * existe para evitar (README 9.3).
     */
    @Test void sinMatriculaNoAfirmaNada() {
        assertFalse(Distintivo.presente(null));
        assertFalse(Distintivo.presente(""));
    }
}
