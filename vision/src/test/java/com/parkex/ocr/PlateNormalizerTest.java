package com.parkex.ocr;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class PlateNormalizerTest {
    private final PlateNormalizer n=new PlateNormalizer();
    @Test void mercosur(){assertEquals("ABC1234",n.normalize(" abc-1234 "));}
    @Test void positionalCorrections(){assertEquals("ABC1234",n.normalize("A8C-I234"));}
    @Test void oldFormat(){assertEquals("SAA123",n.normalize("SAA 123"));}
    // Con ALLOW_SPAIN_PLATES apagado, una matrícula que no es uruguaya se
    // descarta. El patrón español existe sólo para la demo con foto fija.
    @Test void spanishRejectedByDefault(){assertEquals("",n.normalize("H 0724-HPH"));}    
    @Test void ignoresEmblemReadAsLowercaseE(){assertEquals("IAD3852",n.normalize("1ADe3852"));}
    @Test void ignoresExtraSymbolBeforeFourDigits(){assertEquals("IAD3832",n.normalize("IAD23832"));}
    @Test void garbage(){assertEquals("",n.normalize("HELLO"));}
}
