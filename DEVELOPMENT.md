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
E2E_APP_BASE_PATH=/digikladde/ npm run test:e2e -- encryption.spec.ts
```

Playwright baut App und Relay, startet beide und beendet die eigenen Prozesse
nach dem Testlauf. Die Ports `127.0.0.1:4173` (Preview) und `127.0.0.1:8080`
(Relay/Health) muessen frei sein; es wird kein bereits laufender Server uebernommen.
Der Preview-Proxy leitet WebSockets an das lokale Relay weiter. Externe Relays,
Secrets, Kamera und Web-Push werden nicht benoetigt.

Die Tests pruefen Kurs-/Schuelerbearbeitung und einen geteilten Hoehenkurs mit zwei
getrennten Lehrer-Browser-Kontexten: Start, vorgegebene und ergaenzte Manoever,
Bewertungen, Landung, manueller/automatischer Abschluss, Flugdauer, Summen und
Persistenz nach Neuladen. Die Lehrer-Fixture deaktiviert den PWA-Service-Worker.
Die separate `encryption.spec.ts` prueft zusaetzlich opake Sync-/Push- und
Einladungs-Payloads, Einmal-Einloesung, Offline-Catch-up, erneuten Beitritt ohne
Kursduplikate und Reconnect-Fehler ohne unbehandelte Browserfehler oder
wiederholte Fehler-Toasts, auch bei verzoegertem Commit des Verbindungsstatus.
Eine Reset-/Rekey-UI ist nicht enthalten.
Ihr Push-Test aktiviert
den echten gebauten Service Worker, speichert einen synthetischen lokalen
Schluessel und injiziert Push-Events ohne offenen App-Tab. Nur die Lebensdauer
synthetischer Events wird vom Test gehalten; Web Crypto und IndexedDB sind echt.
Der Aufruf von `showNotification` wird aufgezeichnet, weil native
Benachrichtigungen auf manchen Headless-/Betriebssystem-Konfigurationen trotz
Browser-Permission verweigert werden. Native Zustellung und ein externer
Push-Dienst sind damit nicht getestet und werden nicht kontaktiert.
Die allgemeinen Offline-/Update-Funktionen der PWA sind nicht Gegenstand dieser Suite.

E2E-V2 verwendet Web Crypto (HKDF/AES-GCM), zehn Minuten gueltige Einmal-Links
mit Schluessel im URL-Fragment und separate lokale Replay-Zustaende fuer Sync und
Push. Siehe [Protokoll](relay/docs/protocol.md). Der Preview-Proxy muss neben
`/relay` und `/push` auch `/invites` und `/health` weiterleiten. Unit-Tests decken
Manipulation, Bindungen, Schluessellimits, Replay/Transaktions-Rollback und die
Entfernung von V1-Sessions und alten Sync-Ereignissen ohne Verlust lokaler
Kurs-, Schueler- oder Flugdaten ab.

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

Der lokale E2E-Build setzt `GITHUB_ACTIONS=false` fuer seinen eigenen
App-Build/Preview und verwendet die Root-URL. CI testet dagegen den unveraenderten
GitHub-Pages-Build mit Repository-Unterpfad und Hash-Routing.

### CI und Fehlerdiagnose

Der integrierte Workflow `.github/workflows/ci.yml` startet bei Pull Requests,
Branch-Pushes und manuellem Start, unabhaengig von geaenderten Dateipfaden.
Separate Jobs bauen und testen App und Relay parallel. Der App-Job prueft auch
die Browser-Testquellen. Nach erfolgreichen Builds startet E2E mit deren
Artefakten. Erst nach erfolgreichen E2E-Tests publiziert auf `main` ein eigener
Job das Relay-Image; Pushes auf `main` deployen dann ausserdem die App nach
GitHub Pages. Fehlgeschlagene, abgebrochene oder uebersprungene Build-/E2E-Jobs
verhindern Publishing und Deployment. Auf PRs und anderen Branches laufen die
E2E-Tests ohne anschliessendes Publishing oder Deployment.

Nur Laeufe auf `main` publizieren auf GHCR als
`ghcr.io/<owner>/digikladde-relay:main` und zusaetzlich mit dem Tag `:latest`.
Beide Tags verweisen auf dasselbe Image. Es gibt keine dauerhaften
SHA-/Versions-Tags. PRs (einschliesslich Forks) und andere Branches verwenden
ausschliesslich Workflow-Artefakte ohne Registry-Zugangsdaten. Ihre lokalen
Image-Tags werden aus PR-Nummer (`pr-123`) beziehungsweise Branch abgeleitet;
ungueltige Docker-Tag-Zeichen werden durch die Metadata-Action normalisiert.
Manuell startet man den gesamten Workflow `CI`; eine optionale
`docker-push`-Einstellung und separat gestartete Teil-Workflows entfallen.
Es gibt keine pauschale Coverage-Prozenthuerde und keine automatischen Test-Retries.

Bei Browser-Fehlern liegen Screenshots und Traces unter `app/test-results/`,
der HTML-Bericht unter `app/playwright-report/`. GitHub Actions haelt diese
Artefakte sieben Tage vor. Lokal oeffnen:

```bash
npm exec -w app -- playwright show-report
npm exec -w app -- playwright show-trace app/test-results/<test>/trace.zip
```

Der App-Build wird als `app-dist` archiviert; der Relay-Job exportiert ein
Docker-Archiv fuer `linux/amd64` als `relay-image`. Fuer das Multiarch-Publishing
auf `main` wird zusaetzlich das gebaute Relay-Bundle als `relay-dist` uebergeben;
der Publish-Job verwendet denselben Dockerfile und Build-Cache.
Die Build-Artefakte werden einen Tag aufbewahrt und stammen aus demselben Lauf.

E2E laedt `app-dist` nach `app/dist/`, importiert das Relay-Image und startet es
als lokalen Container. Es werden weder App noch Relay im E2E-Job neu gebaut.
`E2E_USE_BUILD_ARTIFACTS=true` aktiviert diesen Modus;
`E2E_APP_BASE_PATH=/<repository-name>/` gibt den im App-Build verwendeten
Pages-Unterpfad an. `E2E_RELAY_IMAGE` waehlt den lokalen PR-/Branch-Image-Tag
aus dem Relay-Job. Fehlende Artefakte fuehren zum Fehler, nicht zu einem
Ersatz-Build oder Registry-Pull. Der Container wird nach dem Lauf entfernt.

E2E prueft diese Build-Ergebnisse lokal auf dem Runner, nicht die veroeffentlichte
Installation. E2E ist eine Voraussetzung fuer beide Veroeffentlichungs-Jobs;
bei E2E-Fehlern wird weder nach GHCR publiziert noch nach GitHub Pages deployt.
Verpflichtende Checks/Branch-Protection muessen separat konfiguriert werden.

### GHCR-Cleanup

Nach erfolgreichem Publishing raeumt ein separater Job alte Versionen des
Packages `digikladde-relay` auf, auch wenn der Deployment-Job fehlschlaegt.
Er behaelt nur den aktuellen Index mit den Tags `main` und `latest`
und alle davon referenzierten Plattform-/Attestierungs-Manifeste.
Veraltete ungetaggte Versionen und alte SHA- oder PR-Tags werden entfernt. Es wird kein
anderes Package angefasst. Publishing und Cleanup teilen sich eine
Concurrency-Gruppe, damit kein gerade publiziertes Image geloescht wird.

Beim Schliessen oder Mergen eines PRs gibt es keinen eigenen Cleanup-Lauf,
da PRs keine GHCR-Images erzeugen. Ohne erfolgreiches Publishing wird der
Cleanup uebersprungen.

Build-/E2E-Jobs haben nur Leserechte. Lediglich Publishing und Cleanup erhalten
`packages: write`; der Deploy-Job erhaelt Pages-/OIDC-Rechte. Das Repository muss
beim GHCR-Package unter **Manage Actions access** Admin-Zugriff besitzen, damit
sein `GITHUB_TOKEN` Versionen loeschen darf. Fehlende Berechtigungen oder
unerwartete Manifestdaten brechen den Cleanup sichtbar ab, statt unkontrolliert
Versionen zu loeschen. `main`-Laeufe werden nicht zugunsten neuerer Laeufe
abgebrochen.

Lockfile-Strategie:

- `package-lock.json` im Repo-Root ist die Quelle fuer Workspace-Installationen (lokal + CI).
- `relay/package-lock.json` bleibt fuer den isolierten Docker-Build im Relay-Ordner erhalten.
- In `app/` gibt es kein eigenes Lockfile mehr.
