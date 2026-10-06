# Skylo-ML: Trainings- und Prüfbericht

Stand: 6. Oktober 2026. **Ziel erreicht:** Das eigene trainierte Modell gewinnt
73,48 % der 6000 unabhängigen vollständigen Testpartien gegen den unveränderten
schweren Bot. Auch die einseitige 95-%-Konfidenzuntergrenze liegt mit 72,57 %
über 70 %. Die Freigabeprüfung ist bestanden.

## Hardware und Umgebung

Live geprüft: Windows 11 Pro, Ryzen 5 5600X mit 6 Kernen/12 Threads,
31,93 GiB RAM und RTX 3080 mit 10 GiB VRAM. CUDA-Berechnung und GPU-Training
wurden tatsächlich ausgeführt. Die TypeScript-Simulation läuft auf der CPU;
sie begrenzt bei diesem kleinen Netzwerk einen Teil des PPO-Durchsatzes.

Runtime, Caches, Daten und Checkpoints liegen unter `D:/AI/SkyloBot`:
Node 24.21.0, isoliertes Python 3.13.2, PyTorch 2.13.0+cu130,
SB3/sb3-contrib 2.9.0, Gymnasium 1.4.0 und ONNX Runtime 1.30.0.
Die globalen Python-/Node-Installationen wurden nicht ersetzt.

## Modell und unveränderte Spielregeln

Die originale TypeScript-Engine und die Referenz-Regel-KI bleiben auf dem Stand
`64a57af86be65a6d59e6a230762a76aecd36084d`. Gespielt werden vollständige
Zweispielerpartien bis 100 Punkte mit `skylo-2-positive-penalty`.

Der Encoder enthält 1426 Zahlen und 28 feste Aktionsindizes. Unbekannte Karten,
bekannte Nullkarten und entfernte Spalten sind unterscheidbar. Seed, private
Kartenwerte, Kartenreihenfolge und Engine-Fingerprints gelangen nicht ins Modell.
Tests prüfen diese Sichtgrenze sowie stabile Aktionsindizes nach Spaltenentfernung.

Das Modell ist ein trainiertes Netzwerk mit gemeinsamem Kandidaten-Scorer.
20 zusätzliche arithmetische Zusammenfassungen werden aus öffentlichen Werten
innerhalb des Netzwerkgraphen berechnet. Bei der Entscheidung gibt es keinen
Aufruf der Regel-KI und keine versteckte Suche. Die Regel-KI erzeugt ausschließlich
Trainingslabels und fungiert als unveränderter Gegner.

Der ausgewählte Stand entstand durch Imitation, DAgger und anschließend
MaskablePPO auf der RTX 3080. Die Gegnerliga enthält verschiedene bestehende
Bots und unveränderliche frühere ONNX-Modelle. Der letzte Trainingsversuch
optimiert den tatsächlichen Partiensieg mit separatem Kritiker und öffentlichem
Potential-Shaping; die Spielregeln und das Prüfziel werden dadurch nicht geändert.

## Vorgelagerte Modellauswahl

Diese Ergebnisse sind **Validierung**, kein Abschlusstest:

| Modell | Prüfweg | Partien | Strikte Siege |
| --- | --- | ---: | ---: |
| BC-v5, angereicherte Imitation | Unabhängige CPU-ONNX-Prüfung | 600 | 404 / 67,33 % |
| PPO-v4b, Schritt 1.000.064 | Unabhängige CPU-ONNX-Prüfung | 600 | 419 / 69,83 % |
| PPO-v4b, Schritt 1.500.032 | GPU-Modellauswahl | 200 | 154 / 77,00 % |
| PPO-v4b, Schritt 1.500.032 | Unabhängige CPU-ONNX-Prüfung | 600 | 438 / 73,00 % |

Alle genannten Partien endeten regulär am Punktelimit. Die ausgewählte CPU-Version
erreichte 72,67 %/73,33 % nach Sitzplatz und eine gemessene Entscheidungszeit
von 0,359 ms im Median auf diesem Windows-PC. Der Stand bei Schritt 1.500.032
wurde vor Beginn des Abschlusstests ausgewählt und eingefroren.

## Reservierter Abschlusstest

Festgelegt vor der ersten Testpartie: **6000 vollständige Partien, 3000 Sitzpaare**.
Jeder Karten-Seed wird mit vertauschten Sitzen gespielt; Unentschieden zählen nicht
als Sieg. Es gibt einen neuen, nur für diesen Test verwendeten Seed-Namensraum.
Das Modell und der Testplan sind schreibgeschützt und durch SHA-256 festgehalten.

Testumfang und Modell werden während des Tests nicht verändert. Die Freigabe
erfordert eine strikte Siegquote über 70 %, eine einseitige 95-%-Untergrenze
aus einem Bootstrap über Sitzpaare über 70 % und ausschließlich reguläre Spielenden.
`verify_release.py` berechnet die Quote aus jeder einzelnen Partie erneut.

Der echte CPU-ONNX-MLBot wurde außerhalb des Python-Trainingsadapters geprüft.
Das vollständige Ergebnis stimmt mit dem vorab gespeicherten Testplan überein:

| Kennzahl | Ergebnis |
| --- | ---: |
| Vollständige Partien / Sitzpaare | 6000 / 3000 |
| Strikte Siege | **4409 / 73,4833 %** |
| Unentschieden (keine Siege) | 38 |
| Niederlagen | 1553 |
| Einseitige 95-%-Untergrenze, 20000 Bootstrap-Stichproben über Sitzpaare | **72,5667 %** |
| Reguläres Spielende am Punktelimit | **6000 / 6000** |
| Siegquote auf Sitz 0 / Sitz 1 | 73,80 % / 73,17 % |
| CPU-Entscheidungszeit Median / 95. Perzentil | 0,321 ms / 0,686 ms |
| Gesamte Testdauer auf diesem PC | 889,29 s |
| Freigabeprüfung | **BESTANDEN** |

Reservierter Namensraum: `final-test-skylo-ml-v1-4ece8a27a60741958de88c39be862ebf`.
Es war der erste reservierte Abschlusstest. Weder Modell noch Stichprobenumfang
wurden nach Einsicht in Zwischenergebnisse verändert.

## Artefakte und Verwendung

Modellpaket: `D:/AI/SkyloBot/releases/skylo-ml-v1`.
`model.onnx` ist 831641 Byte groß und hat die Prüfsumme
`01d964bce402be9997028398799175fb8b7b298430671360675c534e88dfeb74`.

`manifest.json`, `provenance.json`, `validation.json` und `test-plan.json`
enthalten Version, Trainingsherkunft, vorausgehende Validierung und den vorab
festgelegten Test. `final-test.json` enthält alle 6000 Einzelergebnisse,
`gate-audit.json` die bestandene unabhängige Nachprüfung.
Die lokale Startanleitung und das Beispiel für einen späteren Container-Mount
stehen in der README des Modellpakets; die Quellcodeanleitung steht in `ml/README.md`.
Das transportable Paket liegt unter `D:/AI/SkyloBot/releases/skylo-ml-v1.zip`;
die SHA-256-Inventarliste liegt im Modellverzeichnis als `SHA256SUMS.txt`.

Im Backend aktiviert `SKYLO_ML_MANIFEST` die Strategie `Skylo · ML (2 Spieler)`
mit dem Profil `Zweispieler-Modell`. Inferenz läuft auf der CPU und benötigt weder
Python noch CUDA. Der aktuelle Stand unterstützt ausschließlich zwei Spieler.
Ein Hetzner-Deployment und dortige Laufzeitmessungen wurden nicht ausgeführt.

## Prüfungen und Grenzen

- Backend: 98/98 Tests mit echtem ONNX-Modell bestanden.
- Eingefrorener Release-Stand: 6/6 ML-Tests einschließlich Spiel-Runner/Replays
  und Entscheidungen ohne Fallback bestanden.
- Python-Pipeline: 6 Tests für Maskierung, Gradienten, getrennten Kritiker,
  Migration, ONNX-Parität, Kritiker-Warmup und Aktionswahrscheinlichkeiten bestanden.
- Statistische Freigabe: 3 Gegenbeispieltests bestanden; knappe Quoten,
  Unentschieden, manipulierte Ergebnisse, Sicherheitslimits und andere Modellbytes
  können keine falsche Freigabe erzeugen.
- Frontend: TypeScript/Vite-Build und ESLint bestanden; einziges UI-Update ist
  die passende ML-Bezeichnung in der Spieleranzeige.
- Vertragscheck und `git diff --check` bestanden. Der Vertragscheck wurde für
  Windows-Zeilenenden korrigiert: Frontend- und Backend-Protokoll waren inhaltlich
  bereits identisch; CRLF/LF wird jetzt vor dem Vergleich vereinheitlicht.
- `npm audit --omit=dev` meldet für beide Apps 0 Laufzeit-Advisories.

Die Frontend-Installation meldet 7 bestehende Entwicklungsabhängigkeits-Advisories
(2 moderat, 5 hoch) im Tailwind-3-Abhängigkeitsbaum. Frontend-Paketversionen und
Lockfile wurden nicht verändert; das erforderliche Tailwind-4-Upgrade gehört
nicht zur Modellprüfung. Vite meldet außerdem das bestehende große 3D-Bundle.
Die gemessene Spielstärke gilt für die festgelegten Zweispielerregeln und den
unveränderten schweren Bot; andere Gegner und Mehrspielerpartien sind eigene Prüfziele.

Der parallel fortgesetzte Lernlauf wurde bei Schritt 3.000.064 durch die strenge
Export-Paritätsprüfung gestoppt (2 von 896 Testausgaben außerhalb der Toleranz).
Checkpoint und Diagnose sind erhalten; dieser spätere Export ist als ungeprüft
gekennzeichnet und gehört nicht zum Modellpaket. Der vorher eingefrorene Stand
bei 1.500.032 hatte die Exportprüfung bestanden. Für künftige Läufe ist ein
fehlgeschlagener optionaler Snapshot-Export jetzt isoliert: Er gelangt nicht in
die Gegnerliga und bricht das Training nicht mehr ab. Der Fehlerpfad ist getestet;
die numerische Prüftoleranz wurde nicht gelockert. Es läuft kein weiterer Lernjob.
