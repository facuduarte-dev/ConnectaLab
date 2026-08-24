package com.parkex.ocr;
import org.opencv.core.Mat;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.core.Rect;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.concurrent.TimeUnit;
public final class TesseractCli {
    private final String executable; private final PlateNormalizer normalizer;
    public TesseractCli(String executable, PlateNormalizer normalizer) { this.executable = executable; this.normalizer = normalizer; }
    public OcrResult read(Mat image) throws IOException, InterruptedException {
        Path temp = Files.createTempFile("parkex-ocr-", ".png");
        try {
            Imgcodecs.imwrite(temp.toString(), image);
            OcrResult best = OcrResult.unreadable();
            OcrResult mode10 = OcrResult.unreadable(), mode13 = OcrResult.unreadable();
            // 7 funciona bien en recortes limpios; 11 y 13 toleran escudos,
            // tornillos y la palabra URUGUAY dentro de la chapa.
            for (int psm : new int[]{10, 13, 7}) {
                OcrResult result = run(temp, psm);
                if(psm==10) mode10=result;
                if(psm==13) mode13=result;
                if (result.confidence() > best.confidence()) best = result;
            }
            if(mode10.plate().matches("[A-Z]{3}[0-9]{4}") && mode13.plate().matches("[A-Z]{3}[0-9]{4}")) {
                String hybrid=mode13.plate().substring(0,3)+mode10.plate().substring(3);
                return new OcrResult(hybrid,Math.max(.65,Math.max(mode10.confidence(),mode13.confidence())));
            }
            return best;
        } finally { Files.deleteIfExists(temp); }
    }
    public OcrResult readUruguay(Mat plate) throws IOException, InterruptedException {
        int height=Math.max(1,(int)(plate.height()*.76));
        Mat letters=new Mat(plate,new Rect(0,0,Math.max(1,(int)(plate.width()*.42)),height)).clone();
        int numberX=Math.min(plate.width()-1,(int)(plate.width()*.50));
        Mat digits=new Mat(plate,new Rect(numberX,0,plate.width()-numberX,height)).clone();
        String left=plain(letters,"ABCDEFGHIJKLMNOPQRSTUVWXYZ").replaceAll("[^A-Za-z0-9]","").toUpperCase();
        String right=plain(digits,"0123456789").replaceAll("[^A-Za-z0-9]","").toUpperCase();
        if(left.length()<3||right.length()<4) return OcrResult.unreadable();
        String combined=left.substring(Math.max(0,left.length()-3))+right.substring(0,4);
        String normalized=normalizer.normalize(combined);
        return normalized.isEmpty()?OcrResult.unreadable():new OcrResult(normalized,.60);
    }
    private String plain(Mat image,String whitelist) throws IOException,InterruptedException {
        Path temp=Files.createTempFile("parkex-segment-",".png");
        try {
            Imgcodecs.imwrite(temp.toString(),image);
            Process p=new ProcessBuilder(executable,temp.toString(),"stdout","--psm","7","-l","eng","-c","tessedit_char_whitelist="+whitelist).redirectErrorStream(true).start();
            String output=new String(p.getInputStream().readAllBytes(),StandardCharsets.UTF_8);
            if(!p.waitFor(20,TimeUnit.SECONDS)){p.destroyForcibly();return "";}
            return p.exitValue()==0?output:"";
        } finally {Files.deleteIfExists(temp);}
    }
    private OcrResult run(Path image, int psm) throws IOException, InterruptedException {
        Process p = new ProcessBuilder(executable, image.toString(), "stdout", "--psm", String.valueOf(psm), "-l", "eng", "tsv").redirectErrorStream(true).start();
        String output = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (!p.waitFor(20, TimeUnit.SECONDS)) { p.destroyForcibly(); throw new IOException("Tesseract excedió 20 segundos"); }
        if (p.exitValue() != 0) throw new IOException("Tesseract falló: " + output.strip());
        return parseTsv(output);
    }
    OcrResult parseTsv(String tsv) {
        StringBuilder text = new StringBuilder(); double weighted = 0; int chars = 0;
        for (String line : tsv.split("\\R")) {
            String[] c = line.split("\\t", -1); if (c.length < 12) continue;
            try { double conf = Double.parseDouble(c[10]); String word = c[11].strip(); if (conf >= 0 && !word.isEmpty()) { text.append(word); weighted += conf * word.length(); chars += word.length(); } } catch (NumberFormatException ignored) { }
        }
        String plate = normalizer.normalize(text.toString());
        // Tesseract suele asignar 0 a una chapa correcta cuando hay escudo o
        // tornillos. El formato completo validado aporta evidencia adicional;
        // la cámara igualmente exige repetición antes de aceptar el resultado.
        return plate.isEmpty() ? OcrResult.unreadable() : new OcrResult(plate, Math.max(0.50, chars == 0 ? 0 : weighted / chars / 100.0));
    }
}
