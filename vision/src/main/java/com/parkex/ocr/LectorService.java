package com.parkex.ocr;
import org.opencv.core.Mat;
import java.util.*;

/**
 * El servicio de la sección 8 del README. Su ciclo es simple porque el sensor
 * ya hizo la parte difícil: sólo lee las plazas que el backend marcó como
 * pendientes, y no decide nada sobre autorizaciones.
 */
public final class LectorService {
    private final ServiceConfig config;
    private final ApiClient api;
    private final PlateReader reader;
    private final HmacHasher hasher = new HmacHasher();
    private final Consensus consensus = new Consensus();

    public LectorService(ServiceConfig config) {
        this.config = config;
        this.api = new ApiClient(config.apiUrl());
        this.reader = new PlateReader(new PlateDetector(),
                new TesseractCli(System.getenv().getOrDefault("TESSERACT_PATH", "tesseract"), new PlateNormalizer()));
    }

    public void run() throws Exception {
        System.out.printf("Servicio de lectura: %d cámaras, API %s%n", config.cameras().size(), config.apiUrl());
        while (true) {
            for (Map.Entry<Integer, ServiceConfig.Camera> entry : config.cameras().entrySet()) {
                int plazaId = entry.getKey();
                ServiceConfig.Camera camera = entry.getValue();
                try {
                    // Cada cámara pregunta con SU token: deviceAuth ata un
                    // dispositivo de tipo 'camara' a una única plaza.
                    if (!api.pending(camera.token()).contains(plazaId)) continue;
                    process(plazaId, camera);
                } catch (Exception e) {
                    // Una cámara rota no puede tumbar el servicio entero: las
                    // otras plazas reservadas se siguen atendiendo.
                    System.err.printf("plaza %d: %s%n", plazaId, e.getMessage());
                }
            }
            Thread.sleep(config.pollMs());
        }
    }

    private void process(int plazaId, ServiceConfig.Camera camera) throws Exception {
        List<Mat> cuadros = new ArrayList<>();
        // La cámara se abre por evento y se cierra al terminar: fuera de estos
        // segundos no hay nada mirando la plaza (README 6.1). Primero se toman
        // todas las fotos y recién después se leen: tener la cámara abierta
        // mientras corre el OCR alargaría por minutos el rato en que hay algo
        // mirando la plaza, que es justo lo que 6.1 promete que no pasa.
        try (CameraCapture capture = new CameraCapture(camera.source())) {
            cuadros.addAll(capture.frames(config.captures(), config.captureIntervalMs()));
        }

        List<OcrResult> readings;
        try {
            // Los cuadros se leen EN PARALELO. Cada lectura termina en un
            // proceso de Tesseract, que es de un solo hilo y no aprovecha nada
            // de la máquina: en secuencia, ocho cuadros tardaban 72 segundos y
            // la plaza se quedaba en 'pendiente' más de un minuto. Sobre esta
            // computadora, en paralelo, 13. El lector no tiene estado mutable,
            // así que compartirlo entre hilos es seguro.
            readings = cuadros.parallelStream().map(reader::read).toList();
        } finally { cuadros.forEach(Mat::release); }

        OcrResult result = consensus.choose(readings, config.minOccurrences(), config.minConfidence());
        boolean unreadable = result.plate().isEmpty();
        String hash = unreadable ? null : hasher.hash(result.plate(), config.hmacSecret());

        api.report(camera.token(), plazaId, hash, unreadable ? 0 : result.confidence());

        // La matrícula NO se loguea: de esta máquina sale sólo el hash (README 6).
        System.out.printf("plaza %d -> %s (%.2f)%n", plazaId,
                unreadable ? "no_verificable" : hash.substring(0, 12) + "…",
                unreadable ? 0.0 : result.confidence());
    }
}