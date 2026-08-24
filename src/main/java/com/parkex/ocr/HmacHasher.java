package com.parkex.ocr;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
public final class HmacHasher {
    public String hash(String plate, String secret) {
        if (secret == null || secret.length() < 32) throw new IllegalArgumentException("HMAC_SECRET debe tener al menos 32 caracteres");
        try { Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256")); return HexFormat.of().formatHex(mac.doFinal(plate.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException("No se pudo calcular HMAC", e); }
    }
}
