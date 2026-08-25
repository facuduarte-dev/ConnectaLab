package com.parkex.ocr;
import nu.pattern.OpenCV;
import org.opencv.core.Mat;
import org.opencv.imgcodecs.Imgcodecs;
import java.nio.file.*;
import java.util.*;
public final class Main {
    public static void main(String[] args) throws Exception {
        OpenCV.loadLocally();
        if (args.length < 1) { usage(); System.exit(2); }

        // Alta en el padrón: normaliza con el MISMO normalizador que usa el OCR
        // y hashea con la MISMA clave. Es lo único que garantiza que el hash
        // guardado en vehiculos_autorizados y el que reporta la cámara sean
        // idénticos (README 6 y 11).
        if (args[0].equals("hash")) {
            if (args.length < 2) { usage(); System.exit(2); }
            ServiceConfig config = ServiceConfig.load(Path.of(System.getenv().getOrDefault("CONFIG", "config.json")));
            String plate = new PlateNormalizer().normalize(args[1]);
            if (plate.isEmpty()) { System.err.println("No es una matrícula válida: " + args[1]); System.exit(2); }
            System.out.println("matricula normalizada: " + plate);
            System.out.println("matricula_hash:        " + new HmacHasher().hash(plate, config.hmacSecret()));
            return;
        }
        
                if (args[0].equals("service")) {
            new LectorService(ServiceConfig.load(Path.of(args.length > 1 ? args[1] : "config.json"))).run();
            return;
        }

        if (args.length < 2 || (!args[0].equals("image") && !args[0].equals("camera"))) { usage(); System.exit(2); }
        String tess = System.getenv().getOrDefault("TESSERACT_PATH", defaultTesseract());
        PlateReader reader = new PlateReader(new PlateDetector(), new TesseractCli(tess, new PlateNormalizer()));
        List<OcrResult> readings = new ArrayList<>();
        if (args[0].equals("image")) {
            Path path = Path.of(args[1]); if (!Files.isRegularFile(path)) throw new IllegalArgumentException("No existe la imagen: " + path);
            Mat frame = Imgcodecs.imread(path.toString());
            // Aviso antes de empezar: el OCR tarda segundos y sin esta linea la
            // consola se queda muda y parece colgada.
            System.out.printf("Leyendo %s (%dx%d)...%n", path, frame.width(), frame.height());
            OcrResult reading = reader.read(frame); readings.add(reading);
            System.out.printf("Mejor lectura: %s (%.2f)%n", reading.plate().isEmpty()?"sin lectura":reading.plate(), reading.confidence());
        } else {
            try (CameraCapture camera = new CameraCapture(args[1])) {
                int i=0; for (Mat frame : camera.frames(intEnv("CAPTURE_COUNT", 8), intEnv("CAPTURE_INTERVAL_MS", 1200))) {
                    saveDebugFrame(frame, i + 1);
                    OcrResult r = reader.read(frame); readings.add(r); System.out.printf("Toma %d: %s (%.2f)%n", ++i, r.plate().isEmpty()?"sin lectura":r.plate(), r.confidence());
                }
            }
        }
        OcrResult result = new Consensus().choose(readings, args[0].equals("image") ? 1 : intEnv("MIN_OCCURRENCES", 3), doubleEnv("MIN_CONFIDENCE", .80));
        if (result.plate().isEmpty()) { System.out.println("RESULTADO: no_verificable"); return; }
        System.out.printf("RESULTADO: %s confianza=%.2f%n", result.plate(), result.confidence());
        String secret=System.getenv("HMAC_SECRET"); if(secret!=null&&!secret.isBlank()) System.out.println("HMAC-SHA256: "+new HmacHasher().hash(result.plate(),secret));
    }
    private static String defaultTesseract(){ Path p=Path.of("C:/Program Files/Tesseract-OCR/tesseract.exe"); return Files.isExecutable(p)?p.toString():"tesseract"; }
    private static void saveDebugFrame(Mat frame, int number) throws Exception {
        String directory = System.getenv("DEBUG_DIR");
        if (directory == null || directory.isBlank()) return;
        Path path = Path.of(directory); Files.createDirectories(path);
        Path output = path.resolve("captura_" + number + ".jpg");
        Imgcodecs.imwrite(output.toString(), frame);
        System.out.printf("  Diagnóstico: %s (%dx%d)%n", output.toAbsolutePath(), frame.width(), frame.height());
    }
    private static int intEnv(String n,int d){try{return Integer.parseInt(System.getenv().getOrDefault(n,String.valueOf(d)));}catch(Exception e){return d;}}
    private static double doubleEnv(String n,double d){try{return Double.parseDouble(System.getenv().getOrDefault(n,String.valueOf(d)));}catch(Exception e){return d;}}
    private static void usage(){System.out.println("Uso:\n  java -jar target/matricula-ocr-1.0.0.jar image imagenes/matricula1.png\n  java -jar target/matricula-ocr-1.0.0.jar camera 0\n  java -jar target/matricula-ocr-1.0.0.jar camera http://IP:PUERTO/video\n  java -jar target/matricula-ocr-1.0.0.jar hash \"SBI 5856\"");}
}