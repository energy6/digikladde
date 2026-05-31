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

Workspace-Installationen laufen ab sofort ueber das Repo-Root mit npm Workspaces.

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

Lockfile-Strategie:

- `package-lock.json` im Repo-Root ist die Quelle fuer Workspace-Installationen (lokal + CI).
- `relay/package-lock.json` bleibt fuer den isolierten Docker-Build im Relay-Ordner erhalten.
- In `app/` gibt es kein eigenes Lockfile mehr.
