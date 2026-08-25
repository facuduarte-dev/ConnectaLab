package com.parkex.ocr;
import java.util.*;
import java.util.stream.Collectors;
public final class Consensus {
    /**
     * Cuantas repeticiones hacen falta lo decide QUIEN LLAMA, no esta clase.
     * Antes habia un piso fijo de 3 acá adentro, y con una sola foto —el modo
     * `image`, que es con el que se prueba el lector— el resultado nunca podia
     * ser otra cosa que no_verificable, leyera bien o mal. El piso de 3 sigue
     * existiendo, pero donde corresponde: en la configuracion de la camara
     * (ocurrencias_minimas), que es el flujo donde hay varias fotos del mismo
     * auto quieto y la repeticion significa algo.
     */
    public OcrResult choose(List<OcrResult> readings, int occurrences, double threshold) {
        List<OcrResult> valid=readings.stream().filter(r -> r.readable(Math.min(threshold,0.50))).toList();
        OcrResult exact=valid.stream().collect(Collectors.groupingBy(OcrResult::plate)).entrySet().stream()
                .filter(e -> e.getValue().size() >= Math.max(1, occurrences))
                .map(e -> {
                    double average = e.getValue().stream().mapToDouble(OcrResult::confidence).average().orElse(0);
                    double combined = 1 - Math.pow(1 - average, e.getValue().size());
                    // La repetición es evidencia, pero no puede inventar calidad que Tesseract
                    // nunca reportó: si todas las lecturas vinieron en el piso de confianza, la
                    // combinación se topea. Tres errores iguales no son una lectura buena.
                    boolean allAtFloor = e.getValue().stream().allMatch(r -> r.confidence() <= 0.51);
                    return new OcrResult(e.getKey(), allAtFloor ? Math.min(combined, 0.79) : combined);
                })
                .filter(r -> r.confidence() >= threshold)
                .max(Comparator.comparingDouble(OcrResult::confidence)).orElse(OcrResult.unreadable());
        if(!exact.plate().isEmpty()) return exact;

        List<OcrResult> sameLength=valid.stream().filter(r->r.plate().length()==7).toList();
        if(sameLength.size()<Math.max(1,occurrences)) return OcrResult.unreadable();
        StringBuilder voted=new StringBuilder(7); double agreement=0;
        for(int position=0;position<7;position++) {
            final int p=position;
            Map<Character,Long> counts=sameLength.stream().collect(Collectors.groupingBy(r->r.plate().charAt(p),Collectors.counting()));
            Map.Entry<Character,Long> winner=counts.entrySet().stream().max(Map.Entry.comparingByValue()).orElseThrow();
            voted.append(winner.getKey()); agreement+=winner.getValue()/(double)sameLength.size();
        }
        double confidence=agreement/7.0;
        return confidence>=threshold?new OcrResult(voted.toString(),confidence):OcrResult.unreadable();
    }
}
