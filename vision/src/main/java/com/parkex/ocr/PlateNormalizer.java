package com.parkex.ocr;
import java.util.Locale;
import java.util.regex.Pattern;
public final class PlateNormalizer {
    private static final Pattern MERCOSUR = Pattern.compile("[A-Z]{3}[0-9]{4}");
    private static final Pattern OLD = Pattern.compile("[A-Z]{3}[0-9]{3}");
    private static final Pattern SPAIN = Pattern.compile("[0-9]{4}[A-Z]{3}");
    private static final boolean ALLOW_SPAIN = Boolean.parseBoolean(System.getenv().getOrDefault("ALLOW_SPAIN_PLATES", "false"));
    public String normalize(String raw) {
        if (raw == null) return "";
        String compactRaw=raw.replaceAll("[^A-Za-z0-9]","");
        java.util.regex.Matcher emblem=Pattern.compile("([A-Za-z0-9]{3})e([0-9]{4})").matcher(compactRaw);
        if(emblem.find()) {
            String withoutEmblem=correctUruguay((emblem.group(1)+emblem.group(2)).toUpperCase(Locale.ROOT));
            if(MERCOSUR.matcher(withoutEmblem).matches()) return withoutEmblem;
        }
        String clean = raw.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        if(clean.length()==8) {
            String dropExtraDigit=correctUruguay(clean.substring(0,3)+clean.substring(4));
            if(MERCOSUR.matcher(dropExtraDigit).matches()) return dropExtraDigit;
        }
        for (int length : new int[]{7, 6}) {
            String best=""; int fewestCorrections=Integer.MAX_VALUE;
            for (int start = 0; start <= clean.length() - length; start++) {
                String slice = clean.substring(start, start + length);
                String candidate = correctUruguay(slice);
                if (MERCOSUR.matcher(candidate).matches() || OLD.matcher(candidate).matches()) {
                    int corrections=corrections(slice,candidate); if(corrections<fewestCorrections){best=candidate;fewestCorrections=corrections;}
                }
                if (length == 7 && ALLOW_SPAIN) { 
                    candidate = correctSpain(slice);
                    if (SPAIN.matcher(candidate).matches()) { int corrections=corrections(slice,candidate); if(corrections<fewestCorrections){best=candidate;fewestCorrections=corrections;} }
                }
            }
            if(!best.isEmpty()) return best;
        }
        return "";
    }
    private int corrections(String source,String normalized){int count=0;for(int i=0;i<source.length();i++)if(source.charAt(i)!=normalized.charAt(i))count++;return count;}
    private String correctUruguay(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) out.append(i < 3 ? letter(value.charAt(i)) : digit(value.charAt(i)));
        return out.toString();
    }
    private String correctSpain(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) out.append(i < 4 ? digit(value.charAt(i)) : letter(value.charAt(i)));
        return out.toString();
    }
    private char letter(char c) { return switch (c) { case '0' -> 'O'; case '1' -> 'I'; case '2' -> 'Z'; case '5' -> 'S'; case '8' -> 'B'; default -> c; }; }
    private char digit(char c) { return switch (c) { case 'O','Q','D' -> '0'; case 'I','L' -> '1'; case 'Z' -> '2'; case 'S' -> '5'; case 'B' -> '8'; default -> c; }; }
}
