package com.parkex.ocr;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class PlateNormalizerTest {
    private final PlateNormalizer n=new PlateNormalizer();
    @Test void mercosur(){assertEquals("ABC1234",n.normalize(" abc-1234 "));}
    @Test void positionalCorrections(){assertEquals("ABC1234",n.normalize("A8C-I234"));}
    /**
     * El formato anterior al Mercosur se descarta por defecto, igual que el
     * espanol, y se enciende con ALLOW_OLD_PLATES=true.
     *
     * No es que el formato viejo no exista: es que aceptarlo SIEMPRE convierte
     * la palabra URUGUAY —impresa en toda chapa Mercosur— en materia prima para
     * inventar matriculas. Tres letras y tres digitos es un molde tan chico que
     * lo llena cualquier cosa: ocho fotos de una misma chapa ABC 1234 dieron
     * UAY550, UAY446, UAY754 y LLZ228, varias con confianza 1,00.
     *
     * Una matricula inventada con confianza alta es el camino directo a una
     * alerta contra alguien que no hizo nada. Vale mas quedarse sin lectura.
     */
    @Test void oldFormatRejectedByDefault(){assertEquals("",n.normalize("SAA 123"));}
    // Con ALLOW_SPAIN_PLATES apagado, una matrícula que no es uruguaya se
    // descarta. El patrón español existe sólo para la demo con foto fija.
    @Test void spanishRejectedByDefault(){assertEquals("",n.normalize("H 0724-HPH"));}    
    @Test void ignoresEmblemReadAsLowercaseE(){assertEquals("IAD3852",n.normalize("1ADe3852"));}
    @Test void ignoresExtraSymbolBeforeFourDigits(){assertEquals("IAD3832",n.normalize("IAD23832"));}
    @Test void garbage(){assertEquals("",n.normalize("HELLO"));}
}
