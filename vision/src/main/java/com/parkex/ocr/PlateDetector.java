package com.parkex.ocr;
import org.opencv.core.*;
import org.opencv.imgproc.Imgproc;
import org.opencv.imgcodecs.Imgcodecs;
import java.nio.file.*;
import java.util.*;
public final class PlateDetector {
    /**
     * Cuantos recortes candidatos se le pasan al OCR y cuantas variantes de
     * preprocesado se prueban sobre cada uno. El producto de los dos es la
     * cuenta que manda: cada combinacion es una imagen mas para Tesseract, y
     * el costo crece lineal. Con 40 x 10 un solo cuadro tardaba mas de tres
     * minutos, que en la practica es lo mismo que estar colgado.
     */
    private static final int MAXIMO_CANDIDATOS = 6;

    public List<Mat> candidates(Mat original) {
        Mat frame = enderezarCuadro(original);
        try {
            return buscarCandidatos(frame);
        } finally { if (frame != original) frame.release(); }
    }

    /**
     * Nivela el cuadro entero ANTES de buscar candidatos.
     *
     * Todo lo que viene despues razona con rectangulos alineados a los ejes:
     * boundingRect() para elegir candidatos, y cortes horizontales para separar
     * la franja del pais de los caracteres. Con la chapa inclinada, el
     * rectangulo alineado que mejor puntua deja de ser el numero y pasa a ser
     * la franja azul, y el recorte que llega a Tesseract es la palabra URUGUAY
     * con los techos de los digitos.
     *
     * Cinco grados alcanzan para romperlo: medido sobre una captura real, la
     * foto tal cual daba una matricula inventada y la misma foto rotada cinco
     * grados daba la correcta.
     *
     * La chapa se busca con minAreaRect y no con boundingRect, y ahi esta la
     * diferencia: la proporcion del rectangulo MINIMO no cambia cuando la chapa
     * gira, asi que sigue pareciendo una chapa. La del rectangulo alineado si
     * cambia, y es justamente lo que hace que una chapa torcida deje de
     * reconocerse como tal.
     */
    private Mat enderezarCuadro(Mat frame) {
        Mat gris = new Mat(), binaria = new Mat(), jerarquia = new Mat();
        List<MatOfPoint> contornos = new ArrayList<>();
        try {
            Imgproc.cvtColor(frame, gris, Imgproc.COLOR_BGR2GRAY);
            Imgproc.threshold(gris, binaria, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);
            Imgproc.findContours(binaria, contornos, jerarquia, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE);

            double areaCuadro = frame.width() * (double) frame.height();
            RotatedRect mejor = null; double mejorArea = 0;
            for (MatOfPoint contorno : contornos) {
                MatOfPoint2f puntos = new MatOfPoint2f(contorno.toArray());
                RotatedRect caja = Imgproc.minAreaRect(puntos);
                puntos.release();
                double largo = Math.max(caja.size.width, caja.size.height);
                double corto = Math.min(caja.size.width, caja.size.height);
                if (corto < 1) continue;
                double proporcion = largo / corto, area = largo * corto;
                if (proporcion < 1.6 || proporcion > 6.5) continue;
                if (area < areaCuadro * .002 || area > areaCuadro * .60) continue;
                if (area > mejorArea) { mejorArea = area; mejor = caja; }
            }
            if (mejor == null) return frame;

            // minAreaRect devuelve el angulo en (0, 90]. Restarle 90 a los
            // mayores de 45 lo lleva a (-45, 45], que es la inclinacion real
            // respecto de la horizontal.
            double angulo = mejor.angle;
            if (angulo > 45) angulo -= 90;
            // Por debajo de 1,5 grados no hay nada que corregir, y por encima
            // de 20 lo mas probable es que la mancha no sea una chapa: rotar
            // por ese angulo empeoraria el cuadro en vez de arreglarlo.
            if (Math.abs(angulo) < 1.5 || Math.abs(angulo) > 20) return frame;

            Mat rotacion = Imgproc.getRotationMatrix2D(
                    new Point(frame.width() / 2.0, frame.height() / 2.0), angulo, 1.0);
            Mat salida = new Mat();
            // BORDER_REPLICATE y no negro: un borde negro nuevo seria un
            // contorno nuevo, y el detector lo tomaria por candidato.
            Imgproc.warpAffine(frame, salida, rotacion, frame.size(),
                    Imgproc.INTER_CUBIC, Core.BORDER_REPLICATE, new Scalar(0, 0, 0));
            rotacion.release();
            return salida;
        } catch (Exception e) {
            // Nivelar es una mejora, no un requisito: si falla, se sigue con el
            // cuadro tal como vino.
            return frame;
        } finally { gris.release(); binaria.release(); jerarquia.release(); contornos.forEach(Mat::release); }
    }

    private List<Mat> buscarCandidatos(Mat frame) {
        Mat gray = new Mat(), edges = new Mat(), hierarchy = new Mat();
        Imgproc.cvtColor(frame, gray, Imgproc.COLOR_BGR2GRAY); Imgproc.Canny(gray, edges, 100, 200);
        List<Rect> rectangles = new ArrayList<>();
        List<MatOfPoint> contours = new ArrayList<>();
        Imgproc.findContours(edges.clone(), contours, hierarchy, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE);
        contours.stream().map(Imgproc::boundingRect).forEach(rectangles::add);

        // En chapas reales el marco suele estar cortado por tornillos, reflejos o
        // sombras. Cerramos pequeños huecos y buscamos también contornos internos.
        Mat closed = new Mat();
        Imgproc.morphologyEx(edges, closed, Imgproc.MORPH_CLOSE,
                Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new Size(17, 5)));
        contours.clear();
        Imgproc.findContours(closed, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE);
        contours.stream().map(Imgproc::boundingRect).forEach(rectangles::add);

        // Las chapas reflectivas claras sobre vehículos oscuros o de color se
        // separan mejor por luminosidad que por su borde exterior.
        Mat bright = new Mat();
        Imgproc.threshold(gray, bright, 145, 255, Imgproc.THRESH_BINARY);
        Imgproc.morphologyEx(bright, bright, Imgproc.MORPH_CLOSE,
                Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new Size(21, 9)));
        contours.clear();
        Imgproc.findContours(bright, contours, hierarchy, Imgproc.RETR_LIST, Imgproc.CHAIN_APPROX_SIMPLE);
        contours.stream().map(Imgproc::boundingRect).forEach(rectangles::add);
        double area = frame.width() * (double) frame.height();
        // El rango de proporciones cubre la chapa Mercosur (400x130 mm, 3,1) y la
        // anterior uruguaya, mas angosta, y tolera la perspectiva de una camara
        // que no mira de frente.
        List<Mat> result = rectangles.stream().filter(r -> r.width >= 70 && r.height >= 18)
                .filter(r -> r.width / (double) r.height >= 1.6 && r.width / (double) r.height <= 6.5)
                .filter(r -> r.area() >= area * .002 && r.area() <= area * .20)
                .sorted(Comparator.comparingDouble(this::plateScore).reversed()).limit(MAXIMO_CANDIDATOS)
                .map(r -> new Mat(frame, r).clone()).toList();
        saveDebugCandidates(result);
        return result;
    }
    private void saveDebugCandidates(List<Mat> candidates) {
        String directory = System.getenv("DEBUG_DIR");
        if (directory == null || directory.isBlank()) return;
        try {
            Path path = Path.of(directory, "candidatos"); Files.createDirectories(path);
            for (int i=0; i<candidates.size(); i++) Imgcodecs.imwrite(path.resolve("candidato_"+(i+1)+".jpg").toString(), candidates.get(i));
        } catch (Exception ignored) { }
    }
    private double plateScore(Rect r) {
        double ratio = r.width / (double) r.height;
        return r.area() / (1.0 + Math.abs(ratio - 3.5));
    }

    /**
     * Seis variantes por candidato, no diez. Las que se fueron eran versiones
     * casi identicas de las que quedaron (la misma banda con y sin ecualizar) y
     * multiplicaban el tiempo de OCR sin aportar lecturas nuevas.
     *
     * Se prueban las dos bandas porque el recorte del detector casi nunca cae
     * justo sobre la chapa: si sobra paragolpes por abajo, los caracteres estan
     * arriba; si la chapa es Mercosur y el recorte es ajustado, arriba esta la
     * franja azul con URUGUAY y los caracteres estan abajo.
     */
    public List<Mat> preprocess(Mat candidate) {
        int w = candidate.width(), h = candidate.height();
        // El marco de la chapa y los tornillos aportan caracteres que no
        // existen (una "S" o una "W" pegadas al principio). Se recortan.
        int side = Math.max(1, (int) (w * .07));
        int inner = Math.max(1, w - 2 * side);

        int lowerY = (int) (h * .30);
        Mat lower = new Mat(candidate, new Rect(side, lowerY, inner, Math.max(1, h - lowerY))).clone();
        Mat lowerGray = new Mat(), lowerLarge = new Mat(), lowerOtsu = new Mat();
        Imgproc.cvtColor(lower, lowerGray, Imgproc.COLOR_BGR2GRAY);
        Imgproc.resize(lowerGray, lowerLarge, new Size(), 2, 2, Imgproc.INTER_CUBIC);
        Imgproc.threshold(lowerLarge, lowerOtsu, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);

        Mat upper = new Mat(candidate, new Rect(side, 0, inner, Math.max(1, (int) (h * .76)))).clone();
        Mat upperGray = new Mat(), upperLarge = new Mat(), upperOtsu = new Mat();
        Imgproc.cvtColor(upper, upperGray, Imgproc.COLOR_BGR2GRAY);
        Imgproc.resize(upperGray, upperLarge, new Size(), 3, 3, Imgproc.INTER_CUBIC);
        Imgproc.threshold(upperLarge, upperOtsu, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);

        // El recorte entero, por si la chapa es de una sola linea (formato
        // anterior al Mercosur) y las dos bandas la cortan por la mitad.
        Mat gray = new Mat(), large = new Mat(), equal = new Mat(), otsu = new Mat();
        Imgproc.cvtColor(candidate, gray, Imgproc.COLOR_BGR2GRAY);
        Imgproc.resize(gray, large, new Size(), 4, 4, Imgproc.INTER_CUBIC);
        Imgproc.equalizeHist(large, equal);
        Imgproc.threshold(equal, otsu, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);

        lower.release(); lowerGray.release(); upper.release(); upperGray.release();
        large.release();
        List<Mat> variantes = new ArrayList<>(List.of(lowerLarge, lowerOtsu, upperLarge, upperOtsu, equal, otsu));
        Mat ajustado = recortarAlBlancoDeLaChapa(candidate, gray);
        if (ajustado != null) variantes.add(ajustado);
        gray.release();
        return variantes;
    }

    /**
     * Ajusta el recorte al rectangulo blanco de la chapa.
     *
     * El detector rara vez acierta el borde exacto: al candidato le sobra
     * paragolpes, parrilla o sombra, y ese sobrante es lo que hace que
     * Tesseract no vea ninguna linea de texto. Binarizar por Otsu y quedarse
     * con la mancha clara mas grande devuelve casi siempre la chapa sola, que
     * es el unico recorte con el que Tesseract lee de forma confiable.
     */
    private Mat recortarAlBlancoDeLaChapa(Mat candidate, Mat gray) {
        Mat binary = new Mat(), hierarchy = new Mat();
        List<MatOfPoint> contours = new ArrayList<>();
        try {
            Imgproc.threshold(gray, binary, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);
            Imgproc.findContours(binary, contours, hierarchy, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE);
            Rect mayor = contours.stream().map(Imgproc::boundingRect)
                    .max(Comparator.comparingDouble(Rect::area)).orElse(null);
            // Si la mancha mas grande es casi todo el candidato no ajusto nada,
            // y si es diminuta no es una chapa: en los dos casos no aporta.
            if (mayor == null || mayor.width < 40 || mayor.height < 12
                    || mayor.area() > candidate.width() * (double) candidate.height() * .92) return null;
            Mat recorte = new Mat(gray, mayor), ampliado = new Mat();
            Imgproc.resize(recorte, ampliado, new Size(), 4, 4, Imgproc.INTER_CUBIC);
            recorte.release();
            return ampliado;
        } finally { binary.release(); hierarchy.release(); contours.forEach(Mat::release); }
    }
}
