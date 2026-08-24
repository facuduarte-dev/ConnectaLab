package com.parkex.ocr;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class HmacHasherTest {@Test void stable(){String s="12345678901234567890123456789012";assertEquals(new HmacHasher().hash("ABC1234",s),new HmacHasher().hash("ABC1234",s));}}
