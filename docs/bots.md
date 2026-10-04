# Bots Zuschauer und Partieprotokolle

Skylo unterstützt menschliche Spieler, regelbasierte Bots, einen Zufallsbot und Zuschauer in derselben Spielumgebung. Der Spielkern, die Strategien, die automatische Ausführung und die Darstellung sind getrennt. Monte Carlo, Reinforcement Learning und LLM-Adapter können später dieselbe Entscheidungsschnittstelle verwenden.

## Spielen und zuschauen

Beim Beitritt werden Name und Rolle gewählt. Menschen und Bots teilen sich zwei bis acht Spielerplätze. Bis zu 32 Zuschauer belegen zusätzliche Plätze außerhalb dieser Spielerzahl. Der erste menschliche Teilnehmer ist Gastgeber und kann selbst Zuschauer bleiben.

Der Gastgeber fügt in der Lobby Bots hinzu, wählt Strategie und Schwierigkeit je Bot und startet die Partie. Regel-KI und Zufallsbot sind verfügbar. Bei einer reinen Bot-Partie lässt sich optional ein Seed für wiederholbare Kartenverteilungen und Bot-Entscheidungen eingeben. Menschenpartien erhalten einen serverseitigen Seed, der bis zum Partieende verborgen bleibt.

Zuschauer dürfen einer laufenden Partie beitreten. Ihr Kamerafokus ist unabhängig von der eigenen Spieleridentität und den anderen Zuschauern. Verdeckte Karten bleiben verborgen. Aufgenommene Karten sind wie im bisherigen Skylo öffentlich sichtbar. Bot-Begründungen lassen sich ein- und ausblenden.

Alle Spielaktionen werden auch serverseitig auf Identität, Phase und erlaubte Aktion geprüft. Zuschauer können weder Kartenaktionen ausführen noch ohne Gastgeberrechte das gemeinsame Tempo ändern.

## Tempo und Einzelschritte

Der Temporegler bestimmt eine zusätzliche Mindestwartezeit zwischen automatischen Teilaktionen von null bis fünf Sekunden. Ein Zug kann aus Ziehen, Tauschen oder Abwerfen und anschließendem Aufdecken bestehen. Die Wartezeit beginnt mit der jeweiligen Entscheidungssituation; Berechnung und Wartezeit dürfen sich überlappen. Die Aktion wird erst ausgeführt, wenn die Berechnung fertig und die Mindestwartezeit abgelaufen ist.

Eine Änderung passt auch eine bereits laufende Wartezeit an. Wird die neue Wartezeit durch die bereits verstrichene Zeit erfüllt, ist die Aktion sofort ausführbar. Der Scheduler gibt trotzdem zwischen Aktionen Zeit an den Event Loop ab. Beim maximalen Tempo entfallen künstliche Pausen. Das Rechenbudget der KI bleibt konstant.

Pause hält automatische Aktionen einschließlich automatischer Folgerunden an. Eine laufende Berechnung darf fertig werden; ihr Ergebnis wartet bis zur Freigabe. „Nächste Aktion“ wendet genau eine Aktion an und bleibt pausiert. „Nächster Zug“ läuft bis zum nächsten Spielerwechsel und bleibt dann pausiert. Während der anfänglichen Aufdeckphase führt ein Zugschritt bis zum ersten normalen Zug. In gemischten Partien warten Schritte gegebenenfalls auf einen Menschen; menschliche Eingaben werden durch die Bot-Pause nicht gesperrt.

Nur der Gastgeber steuert die gemeinsame Ausführung. Andere Zuschauer sehen denselben Spielverlauf. Reine Bot-Partien starten ihre Folgerunden automatisch; in Partien mit Menschen ist der Rundenwechsel eine menschliche Spielaktion.

## Regeln und Lebenszyklus

Die aktuelle Regelversion ist `skylo-2-positive-penalty`. Ein erfolgloser Rundenabschließer erhält doppelte positive Rundenpunkte, wenn er nicht allein die niedrigste Punktzahl hat. Null und negative Punkte werden unverändert addiert. Jeder andere Spieler erhält nach dem Abschluss einen letzten Zug. Am Rundenende werden alle Karten aufgedeckt und gleiche Dreierspalten vor der Wertung entfernt.

Die Partie endet regulär, sobald ein Spieler mindestens 100 Gesamtpunkte erreicht. Der niedrigste Gesamtstand gewinnt; Gleichstände teilen einen Platz. Laufende Serverpartien sind außerdem auf 100 Runden und 100.000 akzeptierte Aktionen begrenzt. Punktlimit, Rundenlimit, Aktionslimit und manueller Abbruch werden im Protokoll unterschieden.

Menschen verlassen durch Refresh oder Verbindungsabbruch ihren Spielerplatz; eine laufende Partie wird dabei abgebrochen. Es gibt noch keine Wiederaufnahme menschlicher Spieler oder automatische Bot-Übernahme. Ein Zuschauerabbruch lässt Bots weiterspielen. Gastgeberrechte gehen an einen verbleibenden menschlichen Teilnehmer. Wenn niemand verbunden ist, erhält der nächste beitretende Mensch die Gastgeberrolle. Eine unbeobachtete laufende Partie wird nach zehn Minuten beendet, auch wenn sie pausiert ist.

Ein abgeschlossenes Protokoll ist 30 Minuten lang exportierbar, auch wenn weiterhin Zuschauer verbunden sind. Danach bleiben bei verbundenen Teilnehmern der finale Spielstand und die Lobby verfügbar; das große Aktionsprotokoll wird freigegeben. Leere abgeschlossene Räume werden nach einer Aufbewahrungsfrist entfernt. Beim Start einer neuen Partie wird das vorherige Protokoll freigegeben. Ein Serverneustart beendet laufende Partien und die Verfügbarkeit dieser Aufzeichnungen.

## Protokoll prüfen

Nach dem Partieende kann der Gastgeber „Partieprotokoll herunterladen“ wählen. Das JSON enthält Regel- und Formatversion, Seeds, Spieler und Strategieversionen, tatsächlich akzeptierte Aktionen, öffentliche Spielereignisse, Entscheidungsdauer, Ersatzentscheidungen, Steuerbefehle und den Abschlussstand. Steuerbefehle werden getrennt von Spielaktionen erfasst. Künstliche Wartezeit zählt nicht zur gemessenen Entscheidungsdauer.

Mit den installierten Entwicklungsabhängigkeiten lässt sich die Datei vom Repository aus prüfen:

```sh
npm run replay -- /absoluter/pfad/skylo-partie.json
```

Der Prüfer führt die aufgezeichneten Aktionen mit dem damaligen Seed erneut aus. Er vergleicht Ereignisse, Revisionen, Zustandsfingerprints und Endergebnis. Er ruft keine Bot-Strategie oder externen Modelle auf. So bleiben auch spätere nichtdeterministische LLM-Antworten als konkrete Partie wiederholbar. Der Prüfer akzeptiert nur unterstützte Format- und Regelversionen; spätere Regeländerungen müssen ältere Replay-Versionen ausdrücklich unterstützen.

## Architektur und Erweiterung

| Modul | Verantwortung |
| --- | --- |
| `src/game/core/GameCore.ts` | Deterministische Regeln, erlaubte Aktionen, Karten, Phasen und Punkte; kopierbare Zustände und Zufallsquellen |
| `src/game/runtime/GameRunner.ts` | Sichtbare Beobachtungen, gemeinsame menschliche und automatische Aktionen, Scheduler, Lebenszyklen, Abbruch und Zeitbudget |
| `src/game/bots/index.ts` | Versionierte Strategie-Registry und unabhängige Bot-Instanzen |
| `src/game/recording` | Begrenzte Aufzeichnung, Export, Ablauf und Replay-Prüfung |
| `src/game/events.ts` | Sessionmitgliedschaft, Rollen, Gastgeberrechte und Socket-Transport |
| `src/protocol/gameProtocol.ts` | Gemeinsamer versionierter Transportvertrag |

Die Modulpfade beziehen sich auf `apps/backend`. Der Frontend-Vertrag wird mit `npm run contracts:sync` nach `apps/frontend/src/types/gameProtocol.ts` erzeugt. `npm run contracts:check` und CI prüfen, dass diese Kopie aktuell ist. Damit lassen sich beide Apps weiterhin unabhängig bauen.

Ein neuer Adapter implementiert `BotStrategy` und registriert eine eindeutige Strategieversion:

```ts
registerBotStrategy({
  id: "my-strategy",
  version: "1",
  name: "Meine Strategie",
  factory: config => new MyStrategy(config),
});
```

Die asynchrone Methode `decide(observation, legalActions, context)` erhält eine unveränderliche Spielerbeobachtung, erlaubte Aktionen, eine eigene deterministische Zufallsfunktion, ein Abbruchsignal und ein Budget. Sie gibt `{ action, explanation? }` zurück. Optionale Hooks `onStart`, `onEvent` und `dispose` bilden den Lebenszyklus einer Bot-Instanz. Ereignisse enthalten ausschließlich öffentliche Informationen. Verdeckte Karten, der interne Spielzustand und Seeds werden nicht an Strategien übergeben.

Aktive Partien halten ihre Strategieversion und Konfiguration fest. Bot-Zufall wird anhand des Seeds, der Sitzposition und der Entscheidungssituation erzeugt; neue zufällige Spieler-IDs verändern daher keine Strategieentscheidungen. Die Regel-KI berücksichtigt Punkte, unbekannte Karten, Spalten, Abschlussrisiko und mangelnden Fortschritt. Letzteres verhindert, dass vorsichtige Bots eine aussichtslose Runde endlos offen halten.

Das Standardbudget beträgt 1.000 Millisekunden und 1.000 Bewertungsschritte je Entscheidung; `RunnerOptions.decisionTimeoutMs` erlaubt ein anderes festes Zeitbudget. Fehler, ungültige Antworten und Zeitüberschreitungen lösen eine erlaubte Ersatzentscheidung der Regel-KI aus und werden als Ersatzentscheidung im Protokoll gekennzeichnet. Verspätete Ergebnisse können die aktuelle Situation nicht mehr verändern.

Für rechenintensive Monte-Carlo- oder RL-Adapter gehört die Berechnung in Worker oder separate Prozesse; ein synchroner CPU-Loop kann nicht allein durch einen JavaScript-Timer unterbrochen werden. Monte Carlo erzeugt plausible unbekannte Zustände aus der Beobachtung und simuliert mit kopierten Spielkernen. RL benötigt einen Beobachtungsencoder und eine separate Trainingsumgebung. Ein LLM-Adapter wählt strukturiert aus den erlaubten Aktionen und beachtet Budget sowie Abbruchsignal. Diese Adapter, dauerhafte Speicherung, Vergleichsserien und eine visuelle Replay-Oberfläche sind spätere Erweiterungen.

## Prüfung der ersten Version

`npm run check` prüft Protokollgleichheit, Frontend-Lint, Spielkern, Strategien, Scheduler, Protokolle, reale Socket-Interaktionen und beide Produktions-Builds. Die Browserprüfung mit `npm run browser:check` benötigt laufende Entwicklungsserver und Chromium. Sie erfasst Screenshots und prüft echte Bedienabläufe, Zuschauerrechte, Einzelschritte, Live-Tempo, Export und Replay sowie menschliche Eingaben.
