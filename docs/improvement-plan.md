# Skylo: Bestandsaufnahme und Verbesserungsplan

Stand: 4. Oktober 2026. Ziel des Nutzers: Die vorhandene 3D-Spielwelt beibehalten, deutlich schöner gestalten und einfacher bedienen.

## Grundlage und Grenzen

Die Analyse kombiniert drei unabhängige Prüfungen von Backend, Frontend und Betrieb mit einem lokalen Browserdurchlauf. App-Quellcode wurde nicht geändert, Produktion nicht belastet oder verändert. Die erfolgreich in Betrieb genommenen Produktions- und PR-Deployments sind eine gute Grundlage.

Geprüft wurden Quellcode, Deploymentdateien, Paketstände, Lint und gezielte lokale Socket.IO-/Spielregelproben. Die Browserprüfung verwendete zwei getrennte Clients mit 1440 × 900 und 390 × 844 Pixeln, einen lokalen Produktions-Build und Software-WebGL. Screenshots und Browserfehler liegen unter `/workspace/skylo-analysis/2026-10-04/`.

Die lokale Containerkopie hatte zunächst nicht lesbare Grafikdateien durch Dateirechte der Arbeitsumgebung. Nur im temporären Audit-Container wurden Leserechte normalisiert. Dieser Befund wird nicht als bestätigter Produktionsfehler bewertet.

Externe Schrift-, Flowbite- und HDR-Dateien waren durch die Netzwerkregeln der Analyseumgebung gesperrt. Deshalb zeigen die Lobby-Screenshots eine Ersatzschrift. Beim Spielstart führte die fehlende HDR-Datei zu einer unbehandelten Ausnahme und einer weißen Seite. Die vollständige 3D-Spielansicht, echte Mobilgeräte, eine komplette Partie und Gruppen-Sprachchat wurden nicht visuell geprüft. Empfehlungen zur Szene stammen aus Quellcodeprüfung; eine abschließende visuelle Bewertung erfordert einen erfolgreichen Spielansicht-Durchlauf.

## Geprüfter Ablauf

1. **Startseite öffnen — funktionsfähig, Gestaltung ausbaufähig.** Desktop und Mobilansicht zeigen Logo, Join-Feld und Kartenfächer; kein horizontaler Überlauf bei 390 Pixeln. Screenshot `01-lobby-desktop.png`, `02-lobby-mobile.png`.
2. **Raum beitreten — funktionsfähig, wenig Orientierung.** Freier Raumname funktioniert. Es fehlen getrennte Erstellen-/Beitreten-Aktionen, Einladung, Spielernamen und ein Hinweis, worauf gewartet wird. Screenshot `03-waiting-desktop.png`.
3. **Zweiten Spieler aufnehmen — funktionsfähig, Präsenz fehleranfällig.** Zwei Browser können dieselbe Lobby betreten und Start Game wird angezeigt. Unabhängig davon ist ein fehlerhaftes Spielerzahl-Update bei Disconnect eines fremden Clients lokal reproduziert. Screenshots `04-ready-desktop.png`, `05-ready-mobile.png`.
4. **Partie starten — serverseitig erfolgreich, visuelle Prüfung blockiert.** Das Backend liefert Spielzustand. Die externe HDR-Datei ist hier nicht erreichbar; danach verschwinden alle Bedienelemente. Die weißen Screenshots `06` und `07` wurden als Darstellung der Spielwelt verworfen.

## Wichtigste technische Befunde

| Priorität | Befund und Nachweis | Maßnahme |
| --- | --- | --- |
| P0 | Eine Kartenaktion `[999,0]` beendet einen separaten lokalen Original-Backendprozess mit Exit-Code 1. Ungefangener TypeError in `game.ts:252`, Socket-Listener `game.ts:338`. | Laufzeitvalidierung aller Events, Indexgrenzen, Callback-Prüfung, strukturierte Fehlerantworten, keine Zustandsänderung vor erfolgreicher Prüfung. |
| P0 | `handleNewGame` prüft die Mitgliedschaft des Absenders nicht. Eine fremde Session kann gestartet bzw. ihre Partie ersetzt werden. `events.ts:56–73`. | Session aus serverseitiger Zugehörigkeit ableiten, Host-Rechte, erlaubte Phase und wiederholte Requests prüfen. Signaling ebenso begrenzen. |
| P1 | Drei gleiche, vollständig verdeckte Karten werden als entfernbarer Drilling erkannt. Mehrere entfernte Spalten verschieben durch vorwärts laufendes `splice` ihre Indizes. `player.ts:99–118`, `game.ts:485–498`. | Alle drei Aufdeckungsflags müssen wahr sein; Spalten filtern oder rückwärts entfernen. Regressionstests für verdeckte und gleichzeitige Drillinge. |
| P1 | Verbindungsabbruch beendet die Partie; Identität hängt an `socket.id`. Kein Wiederbeitritt nach Refresh. `game.ts:538–558`, `App.tsx`. | Stabile Spieleridentität, Resume-Token, Wiederverbindungsfrist, vollständiger Snapshot und eindeutige Aktionsnummern. |
| P1 | Alte Spiele werden aus einer Liste entfernt, Listener und wartende Schleifen bleiben bestehen. Lokale Probe: Kartenlistener 1 → 2 bei Neustart. | Explizites Dispose/Abort, ein Event-Dispatcher je Socket, begrenzte Lebenszyklen. |
| P1 | Drei Lobbyspieler erhalten nach Disconnect eines externen Clients zuletzt `[3,1,1]` statt `[3,3,3]`. `events.ts:87–89`. | Eigene Sessionverwaltung; interne Socket-Räume nicht als Spielräume behandeln. |
| P1 | Spielende bei 100 Punkten ist kein terminaler Zustand; nächste Runde kann trotzdem beginnen. Leerer Nachziehstapel liefert `undefined`. Keine durchgesetzte Spielerobergrenze. | Terminale Zustände, definierter Stapel-Neuaufbau, Kartenanzahl-Invarianten, festgelegte Spielergrenzen. |
| P1 | Ausfall der externen HDR-Datei lässt die gesamte Oberfläche verschwinden. Keine Error Boundary oder nutzbare Ersatzbeleuchtung. | Ressourcen lokal mitliefern, Ladezustand, Fehlergrenze, lokale Beleuchtung als Ersatz und Rückkehr zur Lobby. |

P0: zuerst absichern, da alle Nutzer oder fremde Partien betroffen sein können. P1: Kernfunktion oder Zuverlässigkeit beeinträchtigt.

### Abhängigkeiten und Qualitätskontrollen

- Node 18 ist seit April 2025 außerhalb des Supports. Auf eine zum Umsetzungszeitpunkt unterstützte LTS-Version wechseln; Docker, lokale Version und Actions synchron halten.
- Paketprüfung meldete im Backend ohne Entwicklungsabhängigkeiten 30 betroffene Pakete (3 kritisch, 15 hoch), im vollständigen Frontendbaum 34 (5 kritisch, 18 hoch). Das sind Paketmeldungen, keine 64 nachgewiesenen ausnutzbaren Angriffe.
- Den tatsächlich verwendeten Socket.IO-/Engine.IO-/Parser-/WebSocket-Pfad zuerst aktualisieren. Unbenutzte Alt-Abhängigkeiten entfernen, verbleibende Meldungen nach tatsächlicher Nutzung bewerten. Kein pauschales `npm audit fix --force`.
- CI prüft bisher Builds. Frontend-Lint scheitert aktuell an einer Hook-Abhängigkeit in `CardCache.tsx`; Backend-Testskript ist ein Platzhalter. Deployment muss von erfolgreichen Qualitätsprüfungen abhängen.

## Gestaltungsrichtung

Empfehlung: **ein gemütlicher, klar lesbarer 3D-Spieltisch**. Die Türkis-Familie kann erhalten bleiben, mit dunkleren ruhigen Flächen, warmem Holz bzw. Filz und kontrastreichen Karten. Raumdetails rahmen das Spiel; die eigenen Karten bleiben der optische Schwerpunkt.

- Einheitliche Schrift, klare Größenabstufung, sparsame Schatten, konsistente Abstände und Buttons. Schrift lokal ausliefern.
- Entwicklungsraster, Achsen und grünen Testwürfel entfernen. Beleuchtung, Materialmaßstab und Tischanordnung zusammen abstimmen.
- Eigene Karten groß und zuverlässig erreichbar darstellen. Mitspieler um den Tisch anordnen; Namen, Avatar, Zugmarkierung und Punkte nahe ihrem Platz anzeigen. Aktuell stehen ihre Karten entlang einer Linie.
- Eine feste, kurze Zuganweisung: beispielsweise „Decke zwei Karten auf“ oder „Ziehe eine Karte“. Erlaubte Ziele hervorheben; gesperrte Aktionen erklären.
- Ziehen, Aufdecken, Tauschen und Entfernen eines Drillings durch kurze Animationen nachvollziehbar machen. Reduzierte Bewegung unterstützen.
- Kritische Bedienelemente und Punktestand als normale HTML-Oberfläche über/um die 3D-Ansicht: zugänglich, lesbar und unabhängig von Kameraposition. Tastaturauswahl mit entsprechender Kartenmarkierung in 3D; verdeckte Werte bleiben verborgen.
- Auf dem Handy Kamera und Oberfläche eigenständig anordnen, an Containergröße und Spielerzahl anpassen; Bedienziele etwa 44 Pixel. Keine reine Verkleinerung der Desktopkamera.
- Lobby: „Spiel erstellen“ und „Spiel beitreten“, kurzer Raumcode, Einladungslink, Gastname, Spielerliste und verständlicher Wartestatus. Sprache konsistent, für den Nutzer zunächst Deutsch.
- Verbindungsstatus mit Text statt ausschließlich Farbpunkt; Formularlabel korrekt verknüpfen; Iconbuttons benennen; Meldungen für assistive Technik ankündigen.

## Umsetzung in überprüfbaren Paketen

| Reihenfolge | Paket | Ergebnis und Abnahme |
| --- | --- | --- |
| 1 | Sofortige Backend-Absicherung und Regelkorrekturen | Ungültige Events ändern nichts und lassen den Prozess laufen; Fremde können keine Partie starten; Drillinge, Ende, Stapel und Präsenz sind durch gezielte Tests abgesichert. Runtime/öffentliche Abhängigkeiten aktualisiert; CI blockiert fehlerhafte Deployments. |
| 2, parallel zu 1 | Gestaltungsentwurf | Zwei bis drei Varianten derselben 3D-Welt für Lobby, Desktoptisch und Mobilansicht. Eine klare Empfehlung auswählen. Noch vor großer Umsetzung Feedback zur Richtung einholen. |
| 3 | Spiel- und Session-Lebenszyklus | Regeln vom Socket-Transport trennen; explizite Spielphasen, zentrale Sessionverwaltung, stabile Identität und Resume. Refresh und kurze Netzunterbrechung erhalten die Partie; wiederholte Starts erzeugen keine zusätzlichen Listener. |
| 4 | Sichtbare Überarbeitung | Ausgewählte Richtung mit neuer Lobby, Tischkomposition, responsiver Kamera, Zugführung, Punktestand, Animationen und zugänglicher Bedienung umsetzen. Vergleichbare Preview auf Desktop und Mobilansicht prüfen. |
| 5 | Grafikzuverlässigkeit und Leistung | Assets lokal, Fehleranzeige und WebGL-Recovery; geteilte Texturen/Materialien, stabile Kartenobjekte und sparsamer Stapelaufbau. Nach vielen Zügen kein fortlaufender Speicheranstieg; FPS und Ladezeit auf echten Zielgeräten messen und Budget festlegen. |
| 6 | Betrieb und Wiederherstellung | Versionsgebundene Deploymentdateien je Stack, Sperre gegen konkurrierende Änderungen, Rücknahme auch nach fehlgeschlagenem öffentlichem Routentest. Ressourcen-/Loggrenzen, verwaiste Skylo-Previews bereinigen, Monitoring in vorhandene Server-Infrastruktur integrieren. Spielsnapshots und geplanter Shutdown erhalten Partien bei Neustarts. |
| 7 | Sprachchat absichern | Mikrofonfreigabe behandeln; Tracks und Peer-Verbindungen zuverlässig schließen/neu erstellen. Für Gruppen Verbindung je Teilnehmer und gerichtetes Signaling; TURN bei Bedarf. Mindestens drei Teilnehmer und Ablehnung der Mikrofonfreigabe prüfen. |

Pakete 3 und 6 bauen auf einer klaren Spielzustandsstruktur auf. Paket 4 kann nach Auswahl des Entwurfs parallel entwickelt werden; Änderungen an der bisherigen Spielregelberechnung sollten zuvor abgesichert sein.

### Leistung: konkrete Ansatzpunkte

Karten erzeugen wiederholt eigene Materialien und Texturobjekte; Spielupdates bauen Kartenansichten neu auf. Der Stapel modelliert viele einzelne Karten. Geteilte Ressourcen und nur sichtbare Stapeldetails reduzieren die Arbeit. Instancing oder Render-on-demand erst einsetzen, wenn Messungen Nutzen und Animationsverträglichkeit zeigen.

Der JavaScript-Build liegt ungefähr bei 1,1 MB unkomprimiert. Die rund 21 MB im Assetordner sind nicht gleichbedeutend mit einer 21-MB-Erstladung. Initiale Requests, komprimierte Übertragung, GPU-Speicher und Framezeit separat messen; anschließend Aufteilung/Lazy Loading und Nginx-Caching/Kompression planen.

## Prüfung und Feedback

- Jede Änderung erhält eine automatisch bereitgestellte PR-Preview mit einer kurzen Liste der zu prüfenden Abläufe.
- Technische Abnahme: malformed Events, fremde Sessionaktionen, Doppelklicks, Karteninvarianten, gleichzeitige Drillinge, Rundenschluss, 100-Punkte-Ende, leerer Stapel, Refresh, Verbindungsverlust und wiederholter Spielstart.
- Visuelle Abnahme: erfolgreiche vollständige Spielansicht zuerst; anschließend 2 und 4 Spieler, Portrait-/Landscape-Wechsel, schmale Displays, lange Namen, WebGL-/Assetfehler und Tastaturbedienung. Maximale Spielerzahl gesondert festlegen und testen.
- Betriebsabnahme: parallele PR-/Produktionsdeployments, absichtlich fehlerhaftes neues Release samt Rücknahme, Preview-Cleanup und Backend-Neustart. Diese Eingriffe zunächst isoliert ausführen.
- Human Feedback nach Entwurfswahl, nach erstem spielbaren Tisch und vor Freigabe der überarbeiteten Mobilansicht.

## Entscheidungen vor der jeweiligen Umsetzung

Die grundsätzliche Richtung ist geklärt: bestehende 3D-Welt bewahren. Später gezielt entscheiden: maximale Spielerzahl (2–8 als Vorschlag), strikte Regelvariante bei negativen/gleichen Schlusswerten, Behandlung längerer Abwesenheit und Priorität des Gruppen-Sprachchats. Dafür sind aktuell keine weiteren Serverzugänge oder geheimen Daten nötig.

Empfohlener Start: Paket 1 und die Gestaltungsauswahl aus Paket 2. Damit werden die größten Ausfallrisiken reduziert und die gewünschte Verschönerung früh konkret sichtbar.
