package com.parkex.ocr;
import org.opencv.core.Mat;
import org.opencv.imgcodecs.Imgcodecs;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * Puente con el binario de Tesseract.
 *
 * Tesseract se invoca por LOTE, no por recorte. Arrancar el proceso y cargar
 * eng.traineddata cuesta unos 200 ms y hay que pagarlo una vez por invocacion;
 * el recorte en si cuesta unos 50 ms. Con 20 recortes por cuadro, la diferencia
 * entre 20 invocaciones y una sola es de cuatro segundos contra uno. Tesseract
 * acepta un archivo de texto con la lista de imagenes y numera cada una en la
 * columna page_num del TSV, que es lo que permite volver a separarlas.
 */
public final class TesseractCli {
    /** 11 = texto disperso (encuentra la chapa dentro de un recorte que todavia
     *  trae marco y tornillos), 7 = una unica linea (mejor cuando el recorte ya
     *  es la chapa), 8 = una unica palabra (chapa de una sola linea, sin pais). */
    private static final int[] MODOS = {11, 7, 8};
    private static final int SEGUNDOS_LIMITE = 60;

    private final String executable; private final PlateNormalizer normalizer;
    public TesseractCli(String executable, PlateNormalizer normalizer) { this.executable = executable; this.normalizer = normalizer; }

    /** Cuantos caracteres alfanumericos vio Tesseract, y que matricula salio. */
    record Reading(OcrResult result, int rawLength) { }

    /** Un recorte suelto es un lote de uno. */
    public OcrResult read(Mat image) throws IOException, InterruptedException {
        List<OcrResult> resultados = readAll(List.of(image));
        return resultados.isEmpty() ? OcrResult.unreadable() : resultados.get(0);
    }

    /**
     * Lee todos los recortes de un cuadro. Devuelve una lista alineada con la
     * de entrada: la posicion i es la mejor lectura del recorte i.
     */
    public List<OcrResult> readAll(List<Mat> images) throws IOException, InterruptedException {
        List<OcrResult> mejores = new ArrayList<>(Collections.nCopies(images.size(), OcrResult.unreadable()));
        if (images.isEmpty()) return mejores;

        Path directory = Files.createTempDirectory("parkex-ocr-");
        try {
            List<String> rutas = new ArrayList<>();
            for (int i = 0; i < images.size(); i++) {
                Path png = directory.resolve("recorte_" + i + ".png");
                Imgcodecs.imwrite(png.toString(), images.get(i));
                rutas.add(png.toString());
            }
            Files.write(directory.resolve("lista.txt"), rutas, StandardCharsets.UTF_8);

            int[] descartados = new int[images.size()];
            Arrays.fill(descartados, Integer.MAX_VALUE);

            for (int psm : MODOS) {
                for (Map.Entry<Integer, Reading> entrada : run(directory, psm).entrySet()) {
                    int i = entrada.getKey();
                    if (i < 0 || i >= images.size()) continue;
                    Reading lectura = entrada.getValue();
                    if (lectura.result().plate().isEmpty()) continue;
                    // Un texto crudo que ya tiene el largo de una matricula vale
                    // mas que uno del que hubo que descartar caracteres: los
                    // sobrantes salen del marco y de los tornillos, y descartar
                    // el que no es cambia la matricula entera (IDI1483 leido
                    // "BIDI1483" termina en BID1483).
                    int sobrantes = lectura.rawLength() - lectura.result().plate().length();
                    boolean mejor = sobrantes < descartados[i]
                            || (sobrantes == descartados[i] && lectura.result().confidence() > mejores.get(i).confidence());
                    if (mejor) { mejores.set(i, lectura.result()); descartados[i] = sobrantes; }
                }
            }
            return mejores;
        } finally { borrar(directory); }
    }

    /** Una invocacion de Tesseract sobre toda la lista. Devuelve pagina -> lectura. */
    private Map<Integer, Reading> run(Path directory, int psm) throws IOException, InterruptedException {
        Path base = directory.resolve("salida_" + psm);          // Tesseract le agrega .tsv
        Path diagnostico = directory.resolve("mensajes_" + psm + ".txt");
        Process p = new ProcessBuilder(executable, directory.resolve("lista.txt").toString(), base.toString(),
                "--psm", String.valueOf(psm), "-l", "eng",
                "-c", "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", "tsv")
                // La salida va a un archivo y no a una tuberia: leer la tuberia
                // hasta EOF antes de waitFor() volvia decorativo el limite de
                // tiempo, porque si Tesseract se colgaba el que se colgaba era
                // el read y no la espera.
                .redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.to(diagnostico.toFile()))
                .start();
        if (!p.waitFor(SEGUNDOS_LIMITE, TimeUnit.SECONDS)) {
            p.destroyForcibly();
            throw new IOException("Tesseract excedio " + SEGUNDOS_LIMITE + " segundos");
        }
        Path tsv = directory.resolve("salida_" + psm + ".tsv");
        if (p.exitValue() != 0 || !Files.exists(tsv))
            throw new IOException("Tesseract fallo: " + Files.readString(diagnostico).strip());
        return parseTsvPorPagina(Files.readString(tsv, StandardCharsets.UTF_8));
    }

    /**
     * El TSV de un lote trae todas las imagenes concatenadas; page_num dice de
     * cual es cada fila, empezando en 1 y en el orden de la lista.
     */
    Map<Integer, Reading> parseTsvPorPagina(String tsv) {
        Map<Integer, StringBuilder> texto = new LinkedHashMap<>();
        Map<Integer, double[]> pesos = new LinkedHashMap<>();   // [0] = suma conf*largo, [1] = caracteres
        for (String line : tsv.split("\\R")) {
            String[] c = line.split("\\t", -1); if (c.length < 12) continue;
            try {
                int pagina = Integer.parseInt(c[1].strip()) - 1;
                double conf = Double.parseDouble(c[10]); String word = c[11].strip();
                if (conf < 0 || word.isEmpty()) continue;
                texto.computeIfAbsent(pagina, k -> new StringBuilder()).append(word);
                double[] acumulado = pesos.computeIfAbsent(pagina, k -> new double[2]);
                acumulado[0] += conf * word.length(); acumulado[1] += word.length();
            } catch (NumberFormatException ignored) { }
        }
        Map<Integer, Reading> lecturas = new LinkedHashMap<>();
        texto.forEach((pagina, crudo) -> lecturas.put(pagina, aReading(crudo.toString(), pesos.get(pagina))));
        return lecturas;
    }

    /** El TSV de una sola imagen, que es lo que usan los tests. */
    OcrResult parseTsv(String tsv) {
        Reading lectura = parseTsvPorPagina(tsv).get(0);
        return lectura == null ? OcrResult.unreadable() : lectura.result();
    }

    private Reading aReading(String crudo, double[] pesos) {
        String plate = normalizer.normalize(crudo);
        // Tesseract suele asignar 0 a una chapa correcta cuando hay escudo o
        // tornillos. El formato completo validado aporta evidencia adicional;
        // la camara igualmente exige repeticion antes de aceptar el resultado.
        String compact = crudo.replaceAll("[^A-Za-z0-9]", "");
        double conf = pesos[1] == 0 ? 0 : pesos[0] / pesos[1] / 100.0;
        return new Reading(plate.isEmpty() ? OcrResult.unreadable() : new OcrResult(plate, Math.max(0.50, conf)),
                           compact.length());
    }

    private static void borrar(Path directory) {
        try (Stream<Path> paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (IOException ignored) { }
            });
        } catch (IOException ignored) { }
    }
}
