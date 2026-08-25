package com.parkex.ocr;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

/**
 * Único punto de contacto con la API. El servicio no conoce el padrón: sólo
 * pregunta qué plazas están pendientes y reporta hash + confianza (README 8).
 */
public final class ApiClient {
    private static final int INTENTOS = 4;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper json = new ObjectMapper();
    private final String baseUrl;

    public ApiClient(String baseUrl) { this.baseUrl = baseUrl; }

    /** GET /api/lecturas/pendientes -> ids de plazas ocupadas sin lectura resuelta. */
    public List<Integer> pending(String token) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/api/lecturas/pendientes"))
                .header("Authorization", "Bearer " + token)
                .timeout(Duration.ofSeconds(10)).GET().build();
        List<Integer> ids = new ArrayList<>();
        for (JsonNode plaza : json.readTree(send(request).body())) ids.add(plaza.path("id").asInt());
        return ids;
    }

    /**
     * POST /api/lecturas. hash null significa "no pude leer", y se reporta
     * igual: es lo que distingue no_verificable de no_autorizado (README 9.3)
     * y lo único que saca a la plaza de 'pendiente'.
     *
     * distintivoDi es lo único que el backend no puede averiguar por su cuenta:
     * de acá sale el HMAC y de un hash no se recupera el texto de la chapa.
     */
    public void report(String token, int plazaId, String hash, double confidence, Boolean distintivoDi) throws Exception {
        ObjectNode body = json.createObjectNode();
        body.put("plaza_id", plazaId);
        body.put("matricula_hash", hash);
        body.put("confianza", confidence);
        // null, no false, cuando no hubo lectura. Sin matricula no hay
        // distintivo que mirar, y mandar false ahi seria AFIRMAR que la chapa
        // no lo tenia: convertiria cada foto borrosa en una infraccion, que es
        // exactamente lo que no_verificable existe para evitar (README 9.3).
        if (distintivoDi == null) body.putNull("distintivo_di");
        else body.put("distintivo_di", distintivoDi);
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/api/lecturas"))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        send(request);
    }

    /**
     * Mismo criterio que gateway/src/api.js: un 4xx está mal y va a estar mal
     * siempre (token inválido, plaza inexistente), así que reintentarlo sólo
     * esconde el error real detrás de medio minuto de intentos. Un 5xx sí se
     * reintenta con espera creciente.
     */
    private HttpResponse<String> send(HttpRequest request) throws Exception {
        long espera = 1000;
        String motivo = "";
        for (int intento = 1; intento <= INTENTOS; intento++) {
            try {
                HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() / 100 == 2) return response;
                if (response.statusCode() / 100 == 4)
                    throw new IOException("HTTP " + response.statusCode() + " " + response.body());
                motivo = "HTTP " + response.statusCode() + " " + response.body();
            } catch (IOException e) {
                if (e.getMessage() != null && e.getMessage().startsWith("HTTP 4")) throw e;
                motivo = e.getMessage();
            }
            if (intento == INTENTOS) break;
            Thread.sleep(espera);
            espera *= 2;
        }
        throw new IOException("Falló tras " + INTENTOS + " intentos: " + motivo);
    }
}