package com.parkex.ocr;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
class ConsensusTest {
    @Test void repeated(){OcrResult r=new Consensus().choose(List.of(new OcrResult("ABC1234",.92),new OcrResult("ABC1234",.88),new OcrResult("ABC1238",.99)),2,.8);assertEquals("ABC1234",r.plate());assertTrue(r.confidence()>.90);}
    @Test void insufficient(){assertEquals("",new Consensus().choose(List.of(new OcrResult("ABC1234",.95)),2,.8).plate());}
    @Test void positionalVoteRecoversPlate(){
        OcrResult r=new Consensus().choose(List.of(new OcrResult("IAD3852",.6),new OcrResult("ADE3832",.5),new OcrResult("TAL3832",.6),new OcrResult("IKI3832",.5),new OcrResult("IAD5832",.64),new OcrResult("TAD3832",.6)),2,.75);
        assertEquals("IAD3832",r.plate());
    }
}
