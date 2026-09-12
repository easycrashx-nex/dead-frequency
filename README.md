# DEAD FREQUENCY 1.6.0

Ein Extraction-Shooter aus der Ego-Perspektive für Windows x64: allein offline oder zu zweit im Koop. Durchsuche den 300 × 300 Meter großen Sektor 07, bekämpfe Patrouillen, sichere Beute und handle nach der Extraktion damit.

**[Windows-Spiel herunterladen](https://github.com/easycrashx-nex/dead-frequency/releases/latest)** · [Quellcode](https://github.com/easycrashx-nex/dead-frequency)

## Spielen

Das Windows-ZIP einmal vollständig entpacken und `DEAD FREQUENCY.exe` starten. Den gesamten Programmordner zusammenlassen. Zuerst prüft der Launcher automatisch GitHub auf Updates, danach öffnet sich das Spiel. Kein Konto und keine manuelle Installation erforderlich. Tastatur und Maus, Hardwarebeschleunigung und WebGL2 werden benötigt.

## Mit einem Freund spielen

1. Beide starten dieselbe aktuelle Windows-Version und wählen ihr Kit in der Basis. Vorherige Extraktionsbeute zuerst einlagern.
2. Der Host öffnet **05 KOOP**, gibt seinen Rufnamen ein und klickt **TEAM ERSTELLEN**. Die Internetoption ist bereits eingeschaltet.
3. Sobald die Verbindung bereit ist, **KOPIEREN** drücken und die Einladung dem Freund schicken.
4. Der Freund öffnet **05 KOOP → TEAM BEITRETEN**, fügt die Einladung ein und verbindet sich.
5. Beide klicken **BEREIT MELDEN**; der Host klickt **KOOP-RAID STARTEN**. Falls das Spiel die Maus noch nicht übernommen hat, **FORTSETZEN** drücken.

Beide sehen dieselben Gegner und dieselbe Beute. Jeder Gegenstand einer Kiste kann nur einmal entnommen werden. Abgeworfene Rucksackgegenstände kann der Partner aufnehmen. Gesundheit, Munition, Ausdauer, Kits und Extraktionsrucksäcke bleiben getrennt. Es gibt kein Friendly Fire. Jeder fordert seine eigene Extraktion an und bleibt acht Sekunden in der Zone. Der blaue Operator und die Teamanzeige zeigen deinen Mitspieler.

**Im Koop läuft die Welt bei geöffnetem Menü oder Fensterwechsel weiter.** Bei einem Verbindungsabbruch scheidet der getrennte Spieler aus; seine ungesicherte Beute kann der Partner bergen. Wenn der Host das Team beendet oder die Anwendung schließt, endet die Verbindung für beide. Nach seiner eigenen Extraktion sollte der Host warten, bis der Kollege ebenfalls draußen ist. Beute aus einer bereits abgeschlossenen Extraktion bleibt erhalten.

Die Internet-Einladung läuft über den mitgelieferten Cloudflare-Tunnel, benötigt keine Portfreigabe und gilt nur für die aktuelle Hostsitzung. Der Host-PC berechnet den Raid. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) sind ein kostenloser Dienst ohne Verfügbarkeitsgarantie; bei einer Störung kann eine neue Einladung helfen. Unter **Verbindungsoptionen** lässt sich Internet ausschalten, um direkt im selben LAN/VPN zu spielen. Dann muss die Windows-Firewall die Spielverbindung im verwendeten privaten Netzwerk zulassen. Einladungen nur dem Mitspieler geben.

## Automatische Updates

Bei jedem normalen Start prüft der Launcher das neueste stabile [GitHub-Release](https://github.com/easycrashx-nex/dead-frequency/releases/latest). Eine neuere Version wird ohne Bestätigung heruntergeladen, anhand von SHA-256 geprüft und in einem separaten Versionsordner vorbereitet. Anschließend startet automatisch die neue Version. Es muss kein ZIP von Hand heruntergeladen oder entpackt werden. Während eines Raids wird kein Update eingespielt.

Bei fehlendem Internet oder einem fehlerhaften Download startet die vorhandene Version. Frühere vollständige Installationen bleiben erhalten; ältere Releases ersetzen keine neuere Version. Spielstände liegen getrennt von den Programmdateien im Windows-Benutzerprofil. Für Updates werden ausschließlich öffentliche GitHub-Release-Dateien dieses Projekts verwendet; Zugangstoken werden nicht mitgeliefert.

## Kisten und Beute

Sieben Kistentypen enthalten passende Beutepools: Werkzeug, Elektronik, Sanität, Munition, Vorräte, Industrie und Sicherheit. Sie stehen an Arbeitsplätzen, in Versorgungsbereichen, an Frachtplätzen und in den fünf begehbaren Gebäuden. Insgesamt kommen genau 100 neue Handelsgegenstände zu den bisherigen neun hinzu; Munitions- und Sanitätskisten liefern zusätzlich Verbrauchsmaterial.

Gehe nahe an eine Kiste und drücke **E**. Nach einer kurzen Suche kannst du Gegenstände einzeln oder mit **Alles nehmen** entnehmen. Im selben Fenster siehst du deinen Rucksack und kannst mit **Abwerfen** Platz schaffen. Escape oder die Schließen-Schaltfläche schließen die Kiste; Tab bewegt den Fokus zwischen ihren Schaltflächen. Während der Suche und beim Plündern läuft der Raid weiter.

Der Inhalt wird einmal je Raid bestimmt. Wiederholtes Öffnen würfelt ihn nicht neu. Im Koop teilen beide Spieler den Kisteninhalt; ein Gegenstand landet bei genau einem Spieler. Abgeworfene Gegenstände bleiben als aufnehmbare Beute in der Welt. Alle neuen Handelsgegenstände lassen sich extrahieren, einlagern und auf dem vorhandenen Markt verkaufen.

## Begehbare Gebäude

Fünf Gebäude haben offene Eingänge, eingerichtete Innenräume und zusätzliche Beute:

- **Wachhaus** direkt östlich vom Startpunkt.
- **Lager 04** im zentralen Lagerbezirk.
- **Bahnbüro** am Güterbahnhof im Nordwesten.
- **Zollbüro** an der Zollstation im Osten.
- **Südwerkstatt** im Südlager.

Die Karte hebt diese Gebäude und ihre Eingänge hervor. Laufe durch die offenen Türen hinein; ein Ladebildschirm oder eine Interaktion ist nicht nötig. Die Räume haben jeweils einen zweiten Ausgang. Wände und Einrichtung bieten Deckung; Schüsse, Sichtlinien, Beuteinteraktionen und Gegnerwege berücksichtigen die tatsächlichen Öffnungen. Dieselben Räume und dieselbe Beute stehen auch im Koop zur Verfügung.

## Einstellungen

**EINSTELLUNGEN** in der Basis oder im Pausenmenü öffnet 55 Optionen in sechs Kategorien:

- **Grafik & Anzeige:** Qualitätsprofil, Renderauflösung, Schatten, Partikel, Helligkeit, Kontrast, Sättigung, Sichtfeld, FPS-Limit und Vollbild.
- **Kamera & Bewegung:** Kopfbewegung, Waffenschwanken, Treffererschütterungen, Visier-Zoom, Sprint-Sichtfeld und Waffenanzeige.
- **Maus & Spielweise:** normale und Visier-Empfindlichkeit, invertierte Y-Achse, Halten/Umschalten für Zielen, Sprint und Ducken sowie Nachladen ohne erneuten Schussversuch.
- **Tastenbelegung:** zwölf Bewegungs- und Aktionstasten. Eine Aktion anklicken und die gewünschte Taste drücken; belegte Tasten werden erklärt, Escape bricht die Eingabe ab. Escape für das Menü und F11 für Vollbild bleiben fest.
- **Audio:** Gesamtlautstärke, Waffen, Effekte, Schritte, Umgebung und Hinweise separat; Stummschaltung bei Fensterwechsel und Nachtmodus.
- **HUD & Fadenkreuz:** Größe und Deckkraft, Fadenkreuz mit Farb-/Größenvorschau, Treffer- und Schadensanzeigen, Kompass, Teamanzeige, Interaktionshinweise und FPS-Anzeige.

Die Suche findet Einstellungen über alle Kategorien. Änderungen wirken sofort und werden automatisch gespeichert; vorhandene Einstellungen früherer Versionen bleiben erhalten. Eine Kategorie lässt sich einzeln zurücksetzen, alle Einstellungen über einen zweiten Bestätigungsklick. Spielstände und Lager werden dabei nicht verändert. Beim Sprint-Umschalten beendet Erschöpfung den Sprint; nach Erholung erneut die Sprinttaste drücken. Im Koop läuft die Welt auch bei geöffneten Einstellungen weiter.

## Solo-Raid

1. Scout-Kit und normale Schwierigkeit wählen, dann den Raid starten.
2. Die Kisten in der Nähe des Startpunkts durchsuchen. M öffnet die Karte mit sechs Ausgängen und den zusätzlichen Außenbezirken.
3. Deckung nutzen, auf Patrouillen achten und mit Munition haushalten.
4. An einer Extraktionszone E drücken und acht Sekunden in der Zone bleiben.
5. In der Basis unter **Lager** den Extraktionsrucksack einzeln oder mit **Alles einlagern** leeren. Vorher ist der nächste Raid gesperrt.
6. Unter **Markt** einen gelagerten Gegenstand auswählen, den Wunschpreis eingeben und eine Laufzeit von 2, 5 oder 10 Minuten wählen.
7. Unter **Postfach** Verkaufserlöse beanspruchen oder unverkaufte Waren wieder ins Lager holen. Credits finanzieren Kits und permanente Upgrades.

Die Runde dauert maximal zwölf Minuten. Tod, Ablauf der Zeit oder Aufgabe verlieren die ungesicherte Beute. Erfolgreich extrahierte Gegenstände bleiben erhalten; nur Abschuss- und Relaisboni werden direkt gutgeschrieben. Das Scout-Kit kostet nichts, das Assault-Kit wird beim Raidstart bezahlt. Kontostand, Upgrades, Lager, Extraktionsrucksack, Angebote und Postfach werden lokal gespeichert. Ein laufender Raid wird beim Schließen nicht gespeichert. Vorhandene Spielstände behalten Credits und Upgrades.

## Markt und Rucksack

Mit **Tab** den Rucksack öffnen und bei einem Gegenstand **Abwerfen** klicken. Er liegt anschließend erreichbar in der Welt und kann mit E wieder aufgenommen werden. So wird sofort ein Platz frei. Tab, Escape oder die Schließen-Schaltfläche bringen dich zurück ins Spiel. Die Welt läuft während geöffneter Feldanzeigen weiter; Laufen und Schießen sind währenddessen gesperrt. Außerhalb dieser Anzeigen pausiert Escape den Einsatz.

Der Markt simuliert lokale Käufer und braucht keine Internetverbindung. Der Richtpreis schwankt kontinuierlich mit der Uhrzeit. Die erste Käuferprüfung findet nach 30–45 Sekunden statt, weitere alle 30 Sekunden. Ein günstiger Wunschpreis erhöht die Chance pro Prüfung; ein hoher Preis senkt sie. Die angezeigte Chance ist keine Verkaufsgarantie. Maximal 20 Angebote laufen gleichzeitig, Preise sind ganze Credits zwischen 1 und 1.000.000. Es fallen keine Gebühren an.

Verkaufte Angebote schicken exakt den gewählten Preis ins Postfach. Nach Ablauf unverkaufte oder manuell abgebrochene Angebote schicken den Gegenstand dorthin zurück. **Beanspruchen** übernimmt Credits bzw. lagert den Gegenstand ein. Beim nächsten Start wird verstrichene Zeit nachberechnet; dieselben Käuferprüfungen erhalten bei jedem Laden dasselbe Ergebnis. Es gibt keine echten Spieler oder externen Börsenkurse.

## Steuerung

| Aktion | Taste |
| --- | --- |
| Bewegen | W A S D |
| Umschauen | Maus |
| Feuern | Linke Maustaste |
| Zielen | Rechte Maustaste halten |
| Sprinten | Shift halten |
| Ducken | Strg oder C halten |
| Springen | Leertaste |
| Nachladen | R |
| Beute / Relais / Extraktion | E |
| Medkit | F |
| Karte | M |
| Rucksack | Tab |
| Pause / Maus freigeben | Escape |
| Vollbild umschalten (Windows-App) | F11 |

Im Solo-Modus pausiert ein Fensterwechsel den Raid. Im Koop öffnet sich ein lokales Menü, während die gemeinsame Welt weiterläuft. Im Menü stehen Grafikqualität, Lautstärke und Mausempfindlichkeit zur Verfügung.

## Entwicklung

Node.js 22 oder neuer und pnpm verwenden. Die Einzelspieler-Inhalte laufen lokal. Internet wird für Abhängigkeiten, den erstmaligen Bezug der fest versionierten Tunnel-Komponente, Koop über das Internet und Updates benötigt.

```text
pnpm install --frozen-lockfile
pnpm prepare:tunnel
pnpm test
pnpm build
pnpm dev
pnpm desktop
pnpm package
```

`pnpm dev` startet die lokale Solo-Vorschau auf Port 5194. `pnpm desktop` öffnet den Launcher und den letzten Build. Koop benötigt die Windows-Anwendung. `pnpm package` baut das Windows-Paket aus dem vorhandenen `dist`-Ordner; vorher `pnpm build` ausführen. Das Skript erzeugt es im `outputs/v<VERSION>`-Ordner zwei Ebenen über dem Projekt. `node scripts/qa-coop-native.mjs` prüft zwei echte Windows-Clients über einen Internet-Tunnel und nutzt ausschließlich temporäre Testprofile.

## Aufbau

- `src/simulation.js`: Regeln, Gegner, Treffer, Physik, Extraktion, Wirtschaft und Speicherprüfung.
- `src/economy.js`: dauerhafte Gegenstände, Lager, zeitabhängige Preise, Käuferprüfungen und Postfach.
- `src/recoil.js`: sanfte, begrenzte Rückstoßwinkel, gemeinsam für Kamera und Trefferberechnung.
- `src/layout.js`: gemeinsame Karte für Kollisionen, Darstellung und Übersicht.
- `src/render.js`: Three.js-Welt, Beleuchtung, Waffe, Gegneranimationen und Effekte.
- `src/ui.js` / `src/style.css`: deutsche Menüs und HUD.
- `src/audio.js`: aufgenommene Waffensounds und Foley, räumlicher Klang mit HRTF, Entfernungs-/Deckungsdämpfung, kurze Reflexionen und begrenzte Audiostimmen.
- `public/audio/`: 16 lokal mitgelieferte CC0-Aufnahmen inklusive Quellen, Bearbeitungen und Prüfsummen.
- `src/main.js`: Eingabe, Anwendungsschleife und lokale Speicherung.
- `electron.cjs`: isolierte Desktop-Hülle ohne Node-Zugriff aus dem Spielfenster.
- `src/coop-session.js` / `server/coop-server.js`: autoritative Koop-Simulation mit 60 Ticks und 20 Zustandsübertragungen pro Sekunde.
- `src/coop-client.js` / `src/coop-ui.js`: Netzwerkadapter, Lobby und Team-HUD.
- `platform.cjs` / `preload.cjs`: schmale Desktop-Schnittstelle, Host-Lebensdauer und Internet-Tunnel.
- `launcher/`: automatische GitHub-Prüfung, verifizierter Download, sichere Archivextraktion und Versionsauswahl.

Eine Karte, zwei Einsatz-Kits, zwei Schwierigkeiten, drei dauerhafte Upgrade-Kategorien. Solo gegen KI oder privater Koop für genau zwei Spieler. Lager und Markt bleiben pro Spieler lokal; es gibt keinen gemeinsamen öffentlichen Handelsmarkt oder öffentliches Matchmaking. Modelle und Texturen werden lokal erzeugt. Die Sounds verwenden mitgelieferte Aufnahmen: echte M45- und AK-47-Schüsse als Klangbasis der fiktiven Waffen, Airsoft-Nachlademechanik, Schritte auf hartem Boden und Wind. Gebäude bilden Außenkulisse und Deckung, keine vollständig begehbaren Innenräume.

Version 1.1.0 ersetzt die synthetischen Schüsse und Schritte. Schussvarianten wiederholen sich nicht unmittelbar; die beiden Waffen haben unterschiedliche Klangquellen. Gegnerklänge folgen Entfernung, Blickrichtung und Hindernissen. Schritte hängen von tatsächlicher Bewegung ab, Ducken ist leiser, Sprinten kräftiger. Pause und Tod brechen geplante Nachladegeräusche ab. Der Mixer begrenzt gleichzeitig aktive Stimmen und Spitzenpegel. `node scripts/qa-audio.mjs` prüft die echte Stereo-Ausgabe gegen den laufenden Vite-Server.

Version 1.2.0 ergänzt den vollständigen Lager-/Marktkreislauf und vergrößert die Kartenfläche um den Faktor 6,25. Der Rückstoß ist deutlich kleiner, vorhersehbar und kehrt nach einer Feuerpause vollständig zurück. Kamera und Schussrichtung verwenden dieselben Winkel; Zielen und Ducken reduzieren den Rückstoß zusätzlich.

Version 1.2.1 befestigt das Handgelenk-Display am Arm und korrigiert den Übergang zur Stützhand. Beide Waffen haben wieder etwas kräftigeren Rückstoß: stärkere Einzelimpulse und eine etwas langsamere Erholung ergeben spürbarere Feuerstöße. Die seitliche Bewegung bleibt gering; Kamera und Trefferberechnung bleiben aufeinander abgestimmt.

Version 1.2.2 behebt das schnelle Umschalten zwischen Sprint und Gehen bei leerer Ausdauer. Waffenhaltung, Laufbewegung und Sichtfeld gehen weich ineinander über. Nach Erschöpfung Shift einmal loslassen und mindestens 20 % Ausdauer regenerieren; anschließend ist Sprinten wieder möglich. Dauerhaft gehaltenes Shift startet nach Erschöpfung keinen neuen Sprint von allein.

## Technik und Quellen

Three.js (MIT), Rapier (Apache-2.0), Vite (MIT), Electron (MIT), Playwright (Apache-2.0), ws (MIT), yauzl (MIT), cloudflared (Apache-2.0). Die Lizenzdateien der Desktop-Laufzeit und der Tunnelkomponente liegen dem Windows-Paket bei. `vendor/cloudflared.json` fixiert Download, Version und SHA-256; das Buildskript prüft diese vor dem Verpacken. Technische Referenzen: [Three.js Renderer](https://threejs.org/docs/pages/WebGLRenderer.html), [Rapier Character Controller](https://rapier.rs/docs/user_guides/javascript/character_controller/), [GitHub Releases API](https://docs.github.com/en/rest/releases/releases) und [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

Debug-Zugriff ist nur im Entwicklungsserver oder beim expliziten Start mit `--qa` aktiv. Die normale Windows-Ausgabe veröffentlicht diese Teststeuerung nicht.
