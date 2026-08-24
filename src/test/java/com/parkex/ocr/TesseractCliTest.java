package com.parkex.ocr;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class TesseractCliTest {
    @Test void parsesTextAndConfidenceFromTsv() {
        String header="level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n";
        OcrResult r=new TesseractCli("unused",new PlateNormalizer()).parseTsv(header+"5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t91.5\tABC1234\n");
        assertEquals("ABC1234",r.plate()); assertEquals(.915,r.confidence(),.001);
    }
}
