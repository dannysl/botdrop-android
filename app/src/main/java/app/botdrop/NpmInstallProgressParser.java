package app.botdrop;

public final class NpmInstallProgressParser {

    private NpmInstallProgressParser() {}

    public static int resolvePercent(String line, int currentPercent) {
        if (line == null) {
            return currentPercent;
        }

        String normalized = line.trim();
        if (normalized.isEmpty()) {
            return currentPercent;
        }

        if (normalized.startsWith("npm timing idealTree:init")) return 5;
        if (normalized.startsWith("npm timing idealTree:userRequests")) return 10;
        if (normalized.startsWith("npm timing idealTree:#root")) return 20;
        if (normalized.startsWith("npm timing idealTree:buildDeps")) return 35;
        if (normalized.startsWith("npm timing idealTree Completed")) return 40;
        if (normalized.startsWith("npm timing reify:loadTrees")) return 50;
        if (normalized.startsWith("npm timing reify:diffTrees")) return 55;
        if (normalized.startsWith("npm timing reify:createSparse")) return 60;
        if (normalized.startsWith("npm timing reifyNode:")) return 70;
        if (normalized.startsWith("npm timing reify:unpack")) return 78;
        if (normalized.startsWith("npm timing build:")) return 85;
        if (normalized.startsWith("npm timing reify:build")) return 88;
        if (normalized.startsWith("npm timing reify:save")) return 92;
        if (normalized.startsWith("npm timing auditReport:getReport")) return 95;
        if (normalized.startsWith("npm timing reify:audit")) return 97;
        if (normalized.startsWith("npm timing reify Completed")) return 98;
        if (normalized.startsWith("added ")) return 99;
        if (normalized.startsWith("found ") && normalized.endsWith(" vulnerabilities")) return 100;
        if (normalized.startsWith("npm timing command:install Completed")) return 100;

        return currentPercent;
    }
}
