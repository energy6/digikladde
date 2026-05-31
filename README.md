# DigiKladde - User-Guide

<table>
  <tr>
    <td valign="top" width="520">
      <p>DigiKladde hilft dir dabei, Gleitschirm-Kurse schnell zu organisieren: Kurse anlegen, Schüler verwalten, Flüge dokumentieren, Kurse teilen und am Ende einen PDF-Kursbericht erzeugen.</p>
      <p>Das Demo-Video zeigt einen typischen Ablauf in der App: Zuerst wird aus der Kursübersicht ein neuer Kurs angelegt und direkt bearbeitet. Anschließend werden Schüler hinzugefügt, bestehende Einträge angepasst und nicht mehr benötigte Zuordnungen entfernt.</p>
      <p>Im zweiten Teil startet ein Flug mit Manövern, es werden Bemerkungen erfasst, die Landung durchgeführt, ein geteilter Kurs per QR-Code importiert und die Online-Verbindung eingerichtet. Zum Abschluss wechselt die Demo in die Kursauswertung und zeigt die Erzeugung des PDF-Kursberichts.</p>
      <ul>
        <li>Kurse anlegen, bearbeiten und löschen</li>
        <li>Schüler neu erfassen, bestehenden Kursen zuordnen, bearbeiten und entfernen</li>
        <li>Flüge mit kursabhängigen Angaben und Manövern dokumentieren</li>
        <li>Landungen mit Pending-Phase verwalten und automatisch finalisieren</li>
        <li>Bemerkungen pro Flug erfassen und vor dem nächsten Flug wieder anzeigen</li>
        <li>Kurse per QR-Code teilen und geteilte Kurse hinzufügen</li>
        <li>Online-Modus über Relay-URL und Verbindungstest konfigurieren</li>
        <li>Kursauswertung mit Flughistorie je Schüler anzeigen</li>
        <li>PDF-Kursbericht direkt aus der Auswertung erzeugen</li>
        <li>Offline-Nutzung und Update-Hinweise über die installierbare PWA</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/media/demo.gif" width="240" alt="DigiKladde Demo">
    </td>
  </tr>
</table>

## Kurzablauf mit Screenshots

### 1. Kurs erstellen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Öffne die Kursansicht und lege einen neuen Kurs mit Name, Zeitraum und Kurstyp an.</li>
        <li>Speichere den Kurs.</li>
        <li>Buttons im Bild: Speichern legt den Kurs an, QR-Code öffnet den Scanner zum Beitreten eines geteilten Kurses</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/01-kurs-erstellen.png" alt="Kurs erstellen" width="240">
    </td>
  </tr>
</table>

### 2. Kurs wählen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Wechsle in die Kursliste.</li>
        <li>Wähle den gewünschten Kurs aus, um ihn zu öffnen.</li>
        <li>Buttons im Bild: Plus öffnet die Kurserstellung, Papierkorb aktiviert den Löschmodus, Pfeil beziehungsweise Kartenklick öffnet den Kurs.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/02-kurs-waehlen.png" alt="Kurs wählen" width="240">
    </td>
  </tr>
</table>

### 3. Kursdaten bearbeiten
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Öffne die Kursdetails mittels langem tippen auf den Kurstitel.</li>
        <li>Passe z. B. Name, Zeitraum oder Kurstyp an und speichere die Änderungen.</li>
        <li>Buttons im Bild: Der Speichern-Button im Bearbeitungsdialog übernimmt die Kursänderungen.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/03-kursdaten-bearbeiten.png" alt="Kursdaten bearbeiten" width="240">
    </td>
  </tr>
</table>

### 4. Schüler hinzufügen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Neu anlegen: Erfasse einen neuen Schüler mit den benötigten Stammdaten.</li>
        <li>Bestehende hinzufügen: Wähle bereits vorhandene Schüler aus.</li>
        <li>Buttons im Bild: Plus öffnet den Dialog, die Auswahl wechselt zwischen bestehendem und neuem Schüler, Speichern fügt den Schüler dem Kurs hinzu.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/04-schueler-hinzufuegen-neu.png" alt="Schüler hinzufügen" width="240">
    </td>
  </tr>
</table>

### 5. Schüler bearbeiten und löschen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Bearbeiten: Öffne den Schüler, passe Daten an und speichere.</li>
        <li>Löschen: Entferne den Schüler aus dem Kurs.</li>
        <li>Buttons im Bild: Stift öffnet die Bearbeitung, Papierkorb startet den Löschmodus und Entfernen löscht die markierten Schüler aus dem Kurs.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/05-schueler-bearbeiten-loeschen.png" alt="Schüler bearbeiten und löschen" width="240">
    </td>
  </tr>
</table>

### 6. Schüler starten (inkl. Manöver)
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Starte einen Flug für den Schüler.</li>
        <li>Wähle die durchgeführten Manöver direkt beim Flug.</li>
        <li>Buttons im Bild: Flug starten beginnt die Aufzeichnung des Flugs mit den ausgewählten Angaben und Manövern.</li>
        <li>Doppelklick auf einen gestarteten Schüler öffnet den Bemerkungen-Dialog.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/06-start-manoever.png" alt="Schüler starten mit Manövern" width="240">
    </td>
  </tr>
</table>

### 7. Schüler im Flug
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Während des laufenden Flugs ist der Schüler grün als aktiv markiert und bleibt oben in der Liste.</li>
        <li>So erkennst du sofort, welche Einträge noch offen sind und welche bereits abgeschlossen wurden.</li>
        <li>Buttons im Bild: Flug abbrechen, Schüler landen</li>
        <li>Fußzeile: Zeigt Status lokal/geteilt mit Buttons für Teilen und Neuladen</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/07-schueler-im-flug-gruen.png" alt="Schüler im Flug" width="240">
    </td>
  </tr>
</table>

### 8. Bemerkungen und Manöver im Flug
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Im laufenden Flug kannst du mittels doppel-tippen Bemerkungen ergänzen und Manöver aktualisieren.</li>
        <li>Bemerkungen können diktiert werden.</li>
        <li>Buttons im Bild: Bemerkung diktieren, Speichern.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/08-bemerkung-manoever-im-flug.png" alt="Bemerkungen und Manöver im Flug" width="240">
    </td>
  </tr>
</table>

### 9. Schüler landen und Cooldown
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Beende den laufenden Flug mit Landung.</li>
        <li>Cooldown-Optionen: Überspringen oder in Flug zurücksetzen.</li>
        <li>Buttons im Bild: Zurück in Flug hebt die Landung auf, Weiter schließt den Flug endgültig ab.</li>
        <li>Doppelklick auf einen gelandeten Schüler öffnet den Bemerkungen-Dialog.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/09-landung-cooldown.png" alt="Landung und Cooldown" width="240">
    </td>
  </tr>
</table>

### 10. Bemerkungen erfassen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Nach dem Flug werden gespeicherte Bemerkungen am Schülereintrag sichtbar markiert.</li>
        <li>Doppelt tippen zeigt die Bemerkungen des letzten Fluges an.</li>
        <li>Buttons im Bild: Stift öffnet die Schülerbearbeitung, Flug starten beginnt den nächsten Flug, Warnsymbol kennzeichnet vorhandene Bemerkungen vom letzten Flug.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/10-bemerkung-vorhanden.png" alt="Bemerkung vorhanden" width="240">
    </td>
  </tr>
</table>

### 11. Bemerkungen vor nächstem Flug ansehen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Öffne die Hinweise des letzten Flugs direkt aus der Schülerliste.</li>
        <li>So kannst du die vorhandenen Bemerkungen vor dem nächsten Start noch einmal nachlesen.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/11-bemerkung-ansehen.png" alt="Bemerkung ansehen" width="240">
    </td>
  </tr>
</table>

### 12. Kurs teilen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Öffne im Kurs die Freigabe über den Teilen-Button im Kursfuß.</li>
        <li>Der QR-Code kann von einem anderen Gerät gescannt oder per Link weitergegeben werden.</li>
        <li>Per Link teilen nutzt den System-Teilen-Dialog oder kopiert den Share-Link.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/12-kurs-qr-freigeben.png" alt="Kurs teilen" width="240">
    </td>
  </tr>
</table>

### 13. Geteilten Kurs hinzufügen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Öffne die Kurserstellung und starte den QR-Scanner für einen geteilten Kurs.</li>
        <li>Richte die Kamera auf den QR-Code oder füge den Invite-Link indirekt über den Scanvorgang ein.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/13-kurs-qr-import.png" alt="Geteilten Kurs hinzufügen" width="240">
    </td>
  </tr>
</table>

### 14. Einstellungen für Online-Modus
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Öffne die Einstellungen über das Zahnrad in der Kopfzeile.</li>
        <li>Trage Benutzername und Relay-URL (z.B. https://digikladde.aircursion.de) ein, wenn du den Online-Modus verwenden willst.</li>
        <li>Buttons im Bild: Relay-Verbindung testen prüft die WebSocket-Erreichbarkeit, Speichern übernimmt die Einstellungen.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/14-einstellungen-online-mode.png" alt="Einstellungen für Online-Modus" width="240">
    </td>
  </tr>
</table>

### 15. Kursbericht ansehen und PDF erzeugen
<table>
  <tr>
    <td valign="top" width="520">
      <ul>
        <li>Öffne die Kursbericht-Ansicht.</li>
        <li>Prüfe die Daten und erstelle den PDF-Report.</li>
        <li>Buttons im Bild: Zurück wechselt in die Kursansicht, PDF erzeugt den Kursbericht als Datei, aufklappbare Schülerzeilen zeigen die einzelnen Flüge.</li>
      </ul>
    </td>
    <td valign="top" width="360">
      <img src="docs/screenshots/15-kursbericht-pdf.png" alt="Kursbericht und PDF" width="240">
    </td>
  </tr>
</table>

## Technische Hinweise

Entwicklerdokumentation, PDF-Export-Demo und Setup findest du in [DEVELOPMENT.md](DEVELOPMENT.md).
