# Development

## PDF Export Demo (seeded, ohne Browser)

Mit dem Demo-Skript kannst du einen mehrtaegigen Kurs mit reproduzierbaren Zufallsdaten erzeugen und den PDF-Export lokal als Datei schreiben.

Beispiel:

```bash
cd app
npm run demo:pdf-export -- --seed 42 --days 5 --students 7 --output output/kursbericht-seed42.pdf --course-type Windenkurs
```

Parameter:

- `--seed <zahl>`: reproduzierbare Datengenerierung
- `--days <zahl>`: Anzahl Kurstage
- `--students <zahl>`: Anzahl Schueler
- `--output <pfad>`: Zielpfad der PDF-Datei
- `--course-type <Grundkurs|Windenkurs|Hoehenkurs>`: Kurstyp fuer Spaltenlayout und Flugdaten

Regeln der Demo-Daten:

- pro Tag und Schueler werden 3-5 Fluege erzeugt
- jede Flugdauer liegt zwischen 10 und 20 Minuten

## Developer Setup

Workspace-Installationen laufen ueber das Repo-Root mit npm Workspaces.

```bash
npm ci
```

Wichtige Kommandos:

```bash
npm run lint
npm run lint:app
npm run lint:relay
npm run build:app
npm run typecheck:relay
```

App lokal starten:

```bash
npm run -w app dev
```

Relay lokal starten:

```bash
npm run -w relay dev
```

## Automatisierte Tests

Alle Kommandos werden im Repo-Root ausgefuehrt. Verwende die Node-/npm-Versionen
aus `package.json` und installiere zuerst die Workspace-Abhaengigkeiten mit `npm ci`.

```bash
npm test                       # App-Unit-/Modultests und Relay-Unit-Tests
npm run test:app                # Vitest, einmaliger Lauf
npm run -w app test:watch       # Vitest, Watch-Modus
npm run test:relay              # node:test
npm run typecheck:tests         # App- und Browser-Testquellen/Konfiguration
npm run typecheck:relay
npm run lint
```

App-Tests liegen neben den getesteten Utils. Die datenbankgestuetzten
Snapshot-/Delta-Modultests verwenden Dexie mit fake-indexeddb; jeder Test bekommt
einen frischen Datenbankzustand. Relay-Tests verwenden isolierten In-Memory-State.

### Browser-Integration mit echtem Relay

Chromium einmal installieren; unter Linux werden zusaetzlich Systembibliotheken
benoetigt (`playwright install --with-deps chromium`):

```bash
npm exec -w app -- playwright install chromium
npm run test:e2e
npm run test:e2e -- --grep "shares a flight"
npm run test:e2e -- --grep "shares a flight" --repeat-each=3
```

Playwright baut App und Relay, startet beide und beendet die eigenen Prozesse
nach dem Testlauf. Die Ports `127.0.0.1:4173` (Preview) und `127.0.0.1:8080`
(Relay/Health) muessen frei sein; es wird kein bereits laufender Server uebernommen.
Der Preview-Proxy leitet WebSockets an das lokale Relay weiter. Externe Relays,
Secrets, Kamera und Web-Push werden nicht benoetigt.

Die Tests pruefen Kurs-/Schuelerbearbeitung und einen geteilten Hoehenkurs mit zwei
getrennten Lehrer-Browser-Kontexten: Start, vorgegebene und ergaenzte Manoever,
Bewertungen, Landung, manueller/automatischer Abschluss, Flugdauer, Summen und
Persistenz nach Neuladen. Der PWA-Service-Worker ist im Test deaktiviert; seine
Offline-/Update-Funktionen sind nicht Gegenstand dieser Suite.

**Zeitabhaengige Tests warten keine fachlichen Fristen in Echtzeit ab.**
Unit-Tests verwenden vorgegebene Zeitstempel. Die Browser-Fixture installiert
Playwright Clock vor dem App-Start; `setTime` setzt beide Lehrer auf dieselbe feste
Zeitbasis. `clock.fastForward` springt ueber Long-Press- beziehungsweise
Finalisierungs-Timer und ruft diese hoechstens einmal pro Sprung auf, statt
saemtliche dazwischenliegenden Timer-Ticks nachzuspielen. Produktive Fristen werden nicht verkuerzt:
Die echte Fuenf-Minuten-Grenze wird unmittelbar davor und bei Erreichen geprueft.
Die Flugdauer endet bei der Landemarkierung, nicht erst bei der Finalisierung.
UI und Synchronisation werden ueber Assertions statt fixer Sleeps abgewartet.
Neue zeitabhaengige Tests sollen dieses Muster wiederverwenden.
Interaktive Testselektoren verwenden englische `aria-label`s; sichtbare deutsche
UI-Texte und fachliche Manoevernamen bleiben unveraendert.

Der E2E-Build setzt `GITHUB_ACTIONS=false` ausschliesslich fuer seinen eigenen
App-Build/Preview, sodass lokal und in CI dieselbe Root-URL verwendet wird.
Der regulaere GitHub-Pages-Build mit Repository-Unterpfad bleibt unveraendert.

### CI und Fehlerdiagnose

Der Workflow `.github/workflows/tests.yml` fuehrt Unit-/Modultests und
Chromium-E2E unabhaengig bei Pull Requests, Pushes auf `main` und manuellem Start
aus. Lint und Test-Typechecks laufen ebenfalls. Es gibt keine pauschale
Coverage-Prozenthuerde und keine automatischen Test-Retries.

Bei Browser-Fehlern liegen Screenshots und Traces unter `app/test-results/`,
der HTML-Bericht unter `app/playwright-report/`. GitHub Actions haelt diese
Artefakte sieben Tage vor. Lokal oeffnen:

```bash
npm exec -w app -- playwright show-report
npm exec -w app -- playwright show-trace app/test-results/<test>/trace.zip
```

Die Publishing-Workflows werden dadurch nicht automatisch von den Testergebnissen
abhaengig. Verpflichtende Checks/Branch-Protection muessen separat konfiguriert werden.

Lockfile-Strategie:

- `package-lock.json` im Repo-Root ist die Quelle fuer Workspace-Installationen (lokal + CI).
- `relay/package-lock.json` bleibt fuer den isolierten Docker-Build im Relay-Ordner erhalten.
- In `app/` gibt es kein eigenes Lockfile mehr.
