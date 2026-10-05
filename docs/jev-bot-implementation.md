# Jev · TypeSafe: Betrieb und Validierung

Stand: 5. Oktober 2026. `typesafe-jev-choice`, Version `1`, setzt das [Jev-Konzept](jev-bot-concept.md) als zusätzlichen eigenständigen Bot um. Das Backend nutzt das offizielle SDK `@typesafe-ai/sdk` `0.6.0` und standardmäßig das feste Modell `jev-1.13.0`. Die Live-Dokumentation unter `docs.typesafe.ai` und der API-Host sind aus der aktuellen Codex-Umgebung erreichbar.

## Auswahl und Spielverhalten

Der Server liefert der Lobby einen Bot-Katalog mit Verfügbarkeit, Versionen, Schwierigkeiten und Profilen. Bei Jev wird das Profil „Jev Choice“ gewählt; die Regel-KI behält Leicht/Mittel/Schwer. Bestehende Konfigurationen mit `difficulty` bleiben für die bisherigen Strategien gültig. Jev verwendet `{ strategyId: "typesafe-jev-choice", version: "1", profile: "choice" }`.

Jev wählt unter sämtlichen erlaubten Aktionen. Nur eine einzige erlaubte Aktion wird automatisch ausgeführt und als `automatic` gespeichert. Der Adapter erstellt bekannte Folgen aus der öffentlichen Beobachtung, einschließlich Spaltenentfernung, verbleibender verdeckter Karten und Rundenschluss. Unbekannte Kartenwerte und künftige Züge bleiben ausdrücklich unbekannt. Öffentliche Regeln enthalten das tatsächlich konfigurierte Punkt-, Runden- und Aktionslimit. Namen, Spieler-IDs, Seed, Kartenstapelreihenfolge und verdeckte Kartenwerte werden nicht übertragen. Sichtbare Punktsummen werden aus erneut maskierten Karten berechnet. Die letzten 32 öffentlichen Ereignisse werden über eine Feldliste gekürzt und mit neutralen Sitznummern beschrieben.

Jev entscheidet in jedem Teilzustand separat: erst Ziehen oder Ablage, dann Einsetzen oder Abwerfen, danach gegebenenfalls Aufdecken. Seine Aktionswahrscheinlichkeiten sind keine Gewinnwahrscheinlichkeiten. Die Oberfläche beschreibt die gewählte Aktion anhand der bekannten Fakten; Jev erzeugt keine freie Zugbegründung.

Tempoänderungen lösen keine neue Anfrage aus. Pause lässt eine laufende Anfrage fertig werden und hält die fertige Entscheidung zurück. Einzelschritte wenden sie einmal an. Stoppen, Zustandswechsel und Partieende brechen laufende Anfragen ab; verspätete Antworten verändern das Spiel nicht. Antwortzeit bleibt auch bei maximalem Tempo bestehen.

## Serverkonfiguration und Kostenfreigabe

Ein Schlüssel allein schaltet Jev **nicht** frei. Die Konfiguration benötigt `TYPESAFE_API_KEY`, ein positives ausdrücklich freigegebenes `TYPESAFE_MAX_REQUESTS` und `TYPESAFE_USAGE_FILE`. `apps/backend/.env.example` enthält die Einstellungen; Zugangsdaten gehören ausschließlich in die ignorierte lokale Umgebung oder Deployment-Secrets.

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | leer | Serverseitiger TypeSafe-Schlüssel |
| `TYPESAFE_MODEL` | `jev-1.13.0` | Angefragtes Modell, serverseitig festgelegt |
| `TYPESAFE_MAX_REQUESTS` | `0` | Harte kumulative Obergrenze für diese Backend-Instanz und ihren persistenten Zähler; `0` sperrt Jev |
| `TYPESAFE_MAX_REQUESTS_PER_MATCH` | `10` | Gemeinsame Obergrenze aller Jev-Bots einer Partie |
| `TYPESAFE_DECISION_TIMEOUT_MS` | `15000` | Gesamtzeitbudget einschließlich Warteschlange, unabhängig vom Tempo |
| `TYPESAFE_USAGE_FILE` | lokal `.cache/typesafe-usage.json` | Persistenter Zähler; erforderlich zur Freigabe |
| `TYPESAFE_CONCURRENCY` | `2` | Maximale gleichzeitig laufende Modellanfragen |
| `TYPESAFE_FAILURE_THRESHOLD` | `3` | Anbieterfehler bis zur vorübergehenden Anfragesperre |
| `TYPESAFE_COOLDOWN_MS` | `60000` | Dauer dieser Sperre |

Der Zähler reserviert **vor** jedem Modellaufruf. Fehler und Abbrüche zählen mit, weil gestartete Anfragen beim Anbieter bereits kostenpflichtig sein können. Automatische SDK-Wiederholungen sind ausgeschaltet. Der globale Scheduler hält höchstens 32 wartende Anfragen. Ein beschädigter oder gesperrter Zähler erlaubt keine neue Anfrage. Ein atomarer Dateitausch und eine Schreibsperre verhindern konkurrierende Überschreibungen. Ein Serverneustart setzt die kumulative Grenze nicht zurück. Eine nach einem Prozessabbruch verbleibende `.lock`-Datei sperrt weitere Nutzung, bis der Betreiber sie nach Prüfung des Zählers entfernt.

Diese Grenzen zählen Requests, nicht Guthaben oder Euro. Tokenverbrauch wird aufgezeichnet. Laut [Live-Modellseite](https://docs.typesafe.ai/models) kostet Jev 1.13 aktuell 0,042 USD pro Million Eingabetokens; Ausgabetokens sind frei. Tarife und Rate-Limits können sich ändern. Ein Dollarbudget ist daher keine ungesicherte Annahme im Code. Mehrere unabhängige Preview-Stacks besitzen eigene Grenzen und benötigen jeweils eine Freigabe; das ist kein accountweiter verteilter Zähler.

Timeout, Transportfehler, Rate-Limit, ungültige Antwort, ausgeschöpftes Budget oder eine offene Anfragesperre führen zur mittleren Regel-KI. Die Oberfläche markiert „Ersatzentscheidung · Regel-KI“, und das Protokoll enthält die tatsächliche Quelle und einen sicheren Fehlercode. Anbieterfehlertexte und vollständige Anfragekörper werden nicht geloggt.

## Preview und Produktion

Das GitHub-Secret `TYPESAFE_API_KEY` wird aus dem jeweiligen Environment (`preview` oder `production`) über SSH-Standardeingabe an den Deployment-Helper weitergegeben. Es gelangt ausschließlich in die Backend-Umgebung, nicht in Images, Frontend-Builds oder Kommandoargumente. Die Stack-Umgebungsdatei wird mit Modus `0600` geschrieben. Ein benanntes Volume enthält den Anfragezähler und bleibt bei Updates und Rollbacks erhalten. Beim Entfernen eines PR-Previews wird sein Zählervolume entfernt.

GitHub-Environment-Variablen `TYPESAFE_MODEL`, `TYPESAFE_MAX_REQUESTS`, `TYPESAFE_MAX_REQUESTS_PER_MATCH` und `TYPESAFE_DECISION_TIMEOUT_MS` konfigurieren den Betrieb. Der Workflow übernimmt für das Gesamtbudget standardmäßig **0**. Das bewilligte Limit von zehn Aufrufen gilt für die Codex-Verbindungstests; diese Umsetzung aktiviert deshalb keine zusätzlichen kostenpflichtigen Preview-Partien. Für vollständige Partien oder Vergleichsserien muss ein eigenes Budget eingerichtet werden. Produktion bleibt ohne eigene Freigabe ebenfalls gesperrt.

Nach gesonderter Freigabe zum manuellen Testen mit höchstens **2 €** aktiviert der Workflow ausschließlich die Preview von **PR #6** mit dem festen Modell `jev-1.13.0` und einem kumulativen Limit von **200 Modellanfragen** (ebenfalls höchstens 200 je Partie). Das Limit gilt gemeinsam für alle Räume, Spieler und Besucher dieser Preview. Der vorhandene persistente Zähler wird nicht zurückgesetzt. Die normale Konfiguration für Produktion und andere Previews bleibt unverändert.

Die aktuelle Live-Dokumentation nennt 0,042 USD pro Million Eingabetokens, kostenlose Ausgabetokens und höchstens 64k Kontexttokens pro Anfrage. Konservativ mit 65.536 Tokens gerechnet ergibt das für sämtliche 200 Anfragen höchstens **0,5505024 USD** an Modellkosten. Das schafft deutlichen Abstand zum freigegebenen Eurobetrag, auch gegenüber den beobachteten Anfragen mit nur einigen Tausend Tokens. Dies ist eine harte Anfragegrenze anhand des aktuellen Tarifs, keine direkte Euro-Abrechnungssperre beim Anbieter; Tarifwechsel, Wechselkurs und etwaige Steuern werden nicht vom Backend abgerechnet. Nach Ausschöpfen der Anfragegrenze nutzen bestehende Partien sichtbare Ersatzentscheidungen und neue Jev-Konfigurationen werden abgelehnt. Ein höheres Limit oder zusätzliche Instanzen benötigen eine neue Freigabe.

## Protokolle und Replay

Neue Protokolle verwenden Schema `2`. Der Offline-Verifier unterstützt weiterhin Schema `1`. Die akzeptierten Aktionen sind die Quelle des Replays; es gibt dabei keine Modellaufrufe.

Die optionale `diagnostics` pro Entscheidung enthält Strategie- und Promptversion, angefragtes und zurückgegebenes Modell, SDK-Version, Anbieter-Request-ID soweit vorhanden, Antwortzeit, Eingabe- und Ausgabetokens, ausgewählten Kandidaten, Confidence und Aktionsverteilung. Ein SHA-256-Hash identifiziert den kanonischen Kontext und die Frage. `source` unterscheidet `model`, `automatic`, `strategy` und `fallback`; letztere enthält `failure`. Ein strenger Validator begrenzt Felder und Werte im Export und beim Replay.

Ein vollwertiger Diagnoseexport der Anfragekörper und dauerhafte Spielprotokollspeicherung sind nicht Teil dieser Version. Die bestehenden Spielprotokolle bleiben nach Ende 30 Minuten lang verfügbar.

## Prüfungen

`npm run check` prüft den synchronisierten Transportvertrag, Lint, Backend-Tests und beide Builds. `test/jev.test.cjs` verwendet den echten SDK-Code mit injiziertem HTTP-Transport und prüft Datenschutz, erlaubte Aktionen, bekannte Folgen, Rundenschluss, negative/Null-Spalten, malformed Responses, Budgets, Warteschlange, Circuit Breaker, Timeout, Abbruch, Tempo, Pause und Replay. Diese Tests kosten keine TypeSafe-Aufrufe.

Der explizite Live-Test wird aus `apps/backend` aufgerufen:

```sh
NODE_USE_ENV_PROXY=1 node --require ts-node/register scripts/jev-smoke.cjs --live --max-api-calls 10
```

`NODE_USE_ENV_PROXY=1` verwendet in der Codex-Umgebung den geerbten Proxy. Das Skript zählt auch die authentifizierte Modellabfrage vorsichtshalber mit. Es führt anschließend höchstens zwei Choice-Prüfungen aus. Der persistente Zähler und der Ergebnisbericht liegen in `.cache/jev-smoke/`; wiederholte Läufe teilen dasselbe Gesamtlimit. `SKYLO_SMOKE_DIR` kann einen anderen autorisierten Ablageort festlegen; ein neuer Pfad ist **keine** zusätzliche Kostenfreigabe.

Am 5. Oktober 2026 waren **3 von maximal 10 freigegebenen API-Aufrufen** erfolgreich: eine authentifizierte Modellabfrage und zwei gültige Choice-Antworten von `jev-1.13.0`. Die beiden Entscheidungen benötigten 126 ms und 145 ms, zusammen 5.047 Eingabe- und 166 Ausgabetokens. Diese Einzelmessungen prüfen den Anschluss; sie belegen keine typische Latenz und keine Spielstärke. Die verbleibenden sieben Aufrufe wurden nicht benötigt.

Für Browserprüfungen mit kostenfreien Jev-Antworten kann der Backend-Fixture-Server statt des normalen Backends verwendet werden:

```sh
# Aus apps/backend, mit installiertem ts-node:
TYPESAFE_MAX_REQUESTS=0 node --require ts-node/register test/helpers/jev-browser-server.cjs
# In einem weiteren Terminal aus dem Repository:
npm run dev:frontend
# Mit laufenden Servern und Chromium:
SKYLO_CHECK_JEV=1 npm run browser:check
```

Der Fixture verwendet einen Dummy-Schlüssel und injizierten Transport. Er prüft Lobby-Profil, eine während Pause fertiggestellte Antwort, Einzelschritte, sichtbaren Rate-Limit-Ersatz und Export. Die Browserprüfung bestand elf Prüfgruppen ohne ungefangene Browserfehler. Die normalen Abläufe decken weiterhin Menschen, Zuschauer, acht Bots und natürliche Partieabschlüsse ab. Screenshots zeigen die [Jev-Auswahl](jev/lobby.png) und die [sichtbare Ersatzentscheidung](jev/fallback.png). Zwei zusätzliche Offline-Partien prüften alle Aktionsphasen über mehrere Runden sowie einen vollständigen Abschluss nach ausgeschöpftem Jev-Budget.

Faire Spielstärkemessungen gegen Zufall und die drei Regel-KI-Stufen benötigen vollständige Partien mit gepaarten Seeds und rotierten Sitzen, mehreren Wiederholungen sowie getrennt ausgewiesenen Ersatzquoten. Diese kostenpflichtigen Serien sind noch nicht durchgeführt und durch das Zehn-Aufrufe-Limit nicht freigegeben. Ein späterer Hybrid erhält weiterhin einen eigenen Strategietyp.
