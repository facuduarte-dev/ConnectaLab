package com.parkex.ocr;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.*;

/**
 * Configuración del servicio. Vive en un archivo y no en variables de entorno
 * porque el mapa plaza -> cámara -> token es una tabla, no tres valores sueltos.
 */
public record ServiceConfig(String apiUrl, String hmacSecret, long pollMs, int captures,
                            long captureIntervalMs, double minConfidence, int minOccurrences,
                            Map<Integer, Camera> cameras) {

    public record Camera(String source, String token) { }

    public static ServiceConfig load(Path path) throws Exception {
        JsonNode root = new ObjectMapper().readTree(path.toFile());

        // Sin clave no hay hash, y sin hash el backend no puede comparar contra
        // el padrón. Falla al arrancar y no en la primera lectura de la noche.
        String secret = root.path("hmac_secret").asText("");
        if (secret.length() < 32)
            throw new IllegalArgumentException("hmac_secret debe tener al menos 32 caracteres en " + path);

        Map<Integer, Camera> cameras = new LinkedHashMap<>();
        root.path("camaras").fields().forEachRemaining(entry -> {
            JsonNode value = entry.getValue();
            cameras.put(Integer.parseInt(entry.getKey()),
                        new Camera(value.path("fuente").asText(), value.path("token").asText()));
        });

        return new ServiceConfig(
                root.path("api_url").asText("http://localhost:3000"), secret,
                root.path("intervalo_polling_ms").asLong(5000),
                root.path("capturas").asInt(8),
                root.path("intervalo_capturas_ms").asLong(1200),
                root.path("confianza_minima").asDouble(.80),
                root.path("ocurrencias_minimas").asInt(3),
                cameras);
    }
}