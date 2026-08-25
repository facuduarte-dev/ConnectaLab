package com.parkex.ocr;
import org.opencv.core.Mat;
import java.util.*;
import java.util.stream.Collectors;
public final class PlateReader {
    private final PlateDetector detector; private final TesseractCli tesseract;
    public PlateReader(PlateDetector detector, TesseractCli tesseract) { this.detector = detector; this.tesseract = tesseract; }

    /**
     * Lee la matrícula de un cuadro por VOTACIÓN entre todos los recortes
     * candidatos y todas las variantes de preprocesado.
     *
     * No se elige "la de mayor confianza" porque con la whitelist de caracteres
     * activada Tesseract deja de reportar un valor útil y todas las lecturas
     * empatan en el piso: elegir por confianza degenera en elegir la primera, y
     * la primera suele venir del paragolpes. La repetición es mejor evidencia,
     * que es el mismo criterio que usa Consensus entre cuadros (README 8).
     *
     * Todos los recortes del cuadro se le pasan a Tesseract en un solo lote:
     * ver el comentario de arranque de TesseractCli.
     */
    public OcrResult read(Mat frame) {
        List<Mat> recortes = new ArrayList<>();
        for (Mat candidate : detector.candidates(frame)) {
            try { recortes.addAll(detector.preprocess(candidate)); }
            finally { candidate.release(); }
        }

        List<String> readings;
        try {
            readings = tesseract.readAll(recortes).stream()
                    .map(OcrResult::plate).filter(plate -> !plate.isEmpty()).toList();
        } catch (Exception e) {
            avisarUnaVez(e);
            return OcrResult.unreadable();
        } finally { recortes.forEach(Mat::release); }

        if (readings.isEmpty()) return OcrResult.unreadable();

        List<Map.Entry<String, Long>> ranking = readings.stream()
                .collect(Collectors.groupingBy(p -> p, Collectors.counting()))
                .entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .toList();

        return ganadora(ranking);
    }

    // Se avisa una vez y no por cuadro: en el servicio son ocho cuadros en
    // paralelo cada vez que llega un auto, y ocho lineas iguales por evento
    // tapan la consola sin decir nada nuevo.
    private final java.util.concurrent.atomic.AtomicBoolean avisado =
            new java.util.concurrent.atomic.AtomicBoolean(false);

    /**
     * Un fallo del OCR no puede seguir pareciendo una foto borrosa.
     *
     * Todo lo que pasa por aca termina en OcrResult.unreadable(), que aguas
     * arriba se convierte en no_verificable con confianza 0 — el mismo
     * resultado que da una chapa tapada. Es deliberado: un cuadro que falla no
     * puede tumbar la lectura entera. Pero cuando la causa es que Tesseract no
     * esta donde se lo busca, TODOS los cuadros fallan igual, la plaza queda
     * siempre en no_verificable y no hay una sola linea en ningun lado que lo
     * explique. Un problema de instalacion tiene que verse distinto de una foto
     * mala.
     */
    private void avisarUnaVez(Exception e) {
        if (avisado.getAndSet(true)) return;
        System.err.printf("El OCR no pudo correr: %s%n", e.getMessage());
        System.err.println("Mientras esto pase, TODAS las lecturas van a dar no_verificable. "
                + "Si el mensaje habla del ejecutable, revisa que Tesseract este instalado "
                + "o defini TESSERACT_PATH con la ruta completa.");
    }

    private OcrResult ganadora(List<Map.Entry<String, Long>> ranking) {
        long winner = ranking.get(0).getValue();
        long runnerUp = ranking.size() > 1 ? ranking.get(1).getValue() : 0;
        // Cuánto le saca la ganadora a la segunda. Una chapa leída sin
        // competencia da 1,0; un empate da 0,5.
        double confidence = winner / (double) (winner + runnerUp);
        return new OcrResult(ranking.get(0).getKey(), confidence);
    }
}
