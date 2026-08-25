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

    // Plazas por las que ya se avisó que la API las reporta pendientes pero
    // este servicio no las atiende. Se avisa una vez y no en cada vuelta: el
    // bucle gira cada pocos segundos y repetirlo seria ruido, no información.
    private final Set<Integer> desatendidasAvisadas = new HashSet<>();

    public void run() throws Exception {
        System.out.printf("Servicio de lectura: %d cámaras (plazas %s), API %s%n",
                config.cameras().size(), config.cameras().keySet(), config.apiUrl());
        while (true) {
            for (Map.Entry<Integer, ServiceConfig.Camera> entry : config.cameras().entrySet()) {
                int plazaId = entry.getKey();
                ServiceConfig.Camera camera = entry.getValue();
                try {
                    // Cada cámara pregunta con SU token: deviceAuth ata un
                    // dispositivo de tipo 'camara' a una única plaza.
                    List<Integer> pendientes = api.pending(camera.token());
                    if (!pendientes.contains(plazaId)) { avisarDesatendidas(plazaId, pendientes); continue; }
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

    /**
     * Avisa cuando el backend reporta plazas pendientes que este servicio no
     * atiende.
     *
     * Sin esto el bucle las saltea en silencio: la plaza se queda en
     * 'pendiente' para siempre, la terminal no vuelve a escribir una línea
     * después del cartel de arranque, y no hay ningún error en ningún lado. La
     * causa casi siempre es la misma —config.json apuntando a una plaza que no
     * es la que tiene la cámara— y es indistinguible de "todavía no llegó nadie".
     */
    private void avisarDesatendidas(int plazaId, List<Integer> pendientes) {
        for (int pendiente : pendientes) {
            if (config.cameras().containsKey(pendiente) || !desatendidasAvisadas.add(pendiente)) continue;
            System.err.printf(
                    "La plaza %d está pendiente y ninguna cámara de config.json la atiende "
                    + "(este token cubre la plaza %d). ¿La clave de \"camaras\" es la correcta?%n",
                    pendiente, plazaId);
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

        // Lo ultimo que se mira antes de hashear: despues de esta linea la
        // matricula deja de existir como texto en todo el sistema.
        Boolean distintivo = unreadable ? null : Distintivo.presente(result.plate());

        api.report(camera.token(), plazaId, hash, unreadable ? 0 : result.confidence(), distintivo);

        // La matrícula NO se loguea: de esta máquina sale sólo el hash (README 6).
        System.out.printf("plaza %d -> %s (%.2f)%n", plazaId,
                unreadable ? "no_verificable"
                           : hash.substring(0, 12) + "… distintivo=" + (distintivo ? "sí" : "no"),
                unreadable ? 0.0 : result.confidence());
    }
}