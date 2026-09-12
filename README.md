# DEAD FREQUENCY 1.11.0

Ein Hardcore-Extraction-Shooter aus der Ego-Perspektive für Windows x64: allein offline oder zu zweit im Koop. Durchsuche den **1.500 × 1.500 Meter** großen Sektor 07 mit Bergen, Fluss, Brücken und begehbaren Ortschaften. Sichere Beute und bringe deine eigene Ausrüstung lebend zurück.

Die Welt umfasst 73 begehbare Gebäude, davon 46 mehrgeschossig, sechs ummauerte Ortschaften, drei Brücken, 28 Fahrzeuge und 151 logisch platzierte Kisten. Alle Häuser haben echte Eingänge; obere Stockwerke erreichst du über Treppen. Im Hauptmenü zeigt ein düsterer 3D-Ausrüstungsraum deinen Operator mit dem gewählten Loadout. Waffenwerte und Kaufknopf bleiben im Shop sichtbar, während du im Katalog blätterst.

**[Windows-Spiel herunterladen](https://github.com/easycrashx-nex/dead-frequency/releases/latest)** · [Quellcode](https://github.com/easycrashx-nex/dead-frequency)

## Spielen

Das Windows-ZIP einmal vollständig entpacken und `DEAD FREQUENCY.exe` starten. Den gesamten Programmordner zusammenlassen. Zuerst prüft der Launcher automatisch GitHub auf Updates, danach öffnet sich das Spiel. Kein Konto und keine manuelle Installation erforderlich. Du kannst mit Maus und Tastatur oder einem unterstützten Controller spielen; Hardwarebeschleunigung und WebGL2 werden benötigt.

## Mit einem Freund spielen

1. Beide starten dieselbe aktuelle Windows-Version und wählen ihr Kit in der Basis. Vorherige Extraktionsbeute zuerst einlagern.
2. Der Host öffnet **KOOP**, gibt seinen Rufnamen ein und klickt **TEAM ERSTELLEN**. Die Internetoption ist bereits eingeschaltet.
3. Sobald die Verbindung bereit ist, **KOPIEREN** drücken und die Einladung dem Freund schicken.
4. Der Freund öffnet **KOOP → TEAM BEITRETEN**, fügt die Einladung ein und verbindet sich.
5. Beide klicken **BEREIT MELDEN**; der Host klickt **KOOP-RAID STARTEN**. Falls das Spiel die Maus noch nicht übernommen hat, **FORTSETZEN** drücken.

Beide sehen dieselben Gegner und dieselbe Beute. Jeder Gegenstand einer Kiste kann nur einmal entnommen werden. Abgeworfene Rucksackgegenstände kann der Partner aufnehmen. Gesundheit, Munition, Ausdauer, Waffen, Skills und Extraktionsrucksäcke bleiben getrennt. Es gibt kein Friendly Fire. Jeder fordert seine eigene Extraktion an und bleibt acht Sekunden in der Zone (mit Logistik-Meisterschaft sieben). Der blaue Operator mit seiner gewählten Waffe und die Teamanzeige zeigen deinen Mitspieler. Waffen und Skills vor dem Verbinden auswählen; in der Lobby ist die Ausrüstung gesperrt.

**Im Koop läuft die Welt bei geöffnetem Menü oder Fensterwechsel weiter.** Bei einem Verbindungsabbruch scheidet der getrennte Spieler aus; seine ungesicherte Beute kann der Partner bergen. Wenn der Host das Team beendet oder die Anwendung schließt, endet die Verbindung für beide. Nach seiner eigenen Extraktion sollte der Host warten, bis der Kollege ebenfalls draußen ist. Beute aus einer bereits abgeschlossenen Extraktion bleibt erhalten.

Beim ersten tödlichen Treffer im Koop wirst du **verwundet** und verblutest nach 60 Sekunden. Dein stehender Partner kann dich innerhalb von 2,2 Metern bei freier Sicht mit **E halten** beziehungsweise **Y / △ halten** wiederbeleben. Dafür muss er sechs Sekunden ununterbrochen helfen und ein Medkit besitzen; dieses wird erst bei erfolgreicher Hilfe verbraucht. Loslassen, zu große Entfernung oder eingehender Schaden unterbrechen die Hilfe. Du kehrst mit 35 Lebenspunkten zurück. Ein zweiter tödlicher Treffer, Verbluten oder zwei gleichzeitig verwundete Spieler beenden die Rettungsmöglichkeit. Vollständig tote Spieler können nicht wiederbelebt werden. Im Solo-Raid gibt es keine Selbstwiederbelebung.

Die Internet-Einladung läuft über den mitgelieferten Cloudflare-Tunnel, benötigt keine Portfreigabe und gilt nur für die aktuelle Hostsitzung. Der Host-PC berechnet den Raid. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) sind ein kostenloser Dienst ohne Verfügbarkeitsgarantie; bei einer Störung kann eine neue Einladung helfen. Unter **Verbindungsoptionen** lässt sich Internet ausschalten, um direkt im selben LAN/VPN zu spielen. Dann muss die Windows-Firewall die Spielverbindung im verwendeten privaten Netzwerk zulassen. Einladungen nur dem Mitspieler geben.

## Automatische Updates

Bei jedem normalen Start prüft der Launcher das neueste stabile [GitHub-Release](https://github.com/easycrashx-nex/dead-frequency/releases/latest). Eine neuere Version wird ohne Bestätigung heruntergeladen, anhand von SHA-256 geprüft und in einem separaten Versionsordner vorbereitet. Anschließend startet automatisch die neue Version. Es muss kein ZIP von Hand heruntergeladen oder entpackt werden. Während eines Raids wird kein Update eingespielt.

Bei fehlendem Internet oder einem fehlerhaften Download startet die vorhandene Version. Frühere vollständige Installationen bleiben erhalten; ältere Releases ersetzen keine neuere Version. Spielstände liegen getrennt von den Programmdateien im Windows-Benutzerprofil. Für Updates werden ausschließlich öffentliche GitHub-Release-Dateien dieses Projekts verwendet; Zugangstoken werden nicht mitgeliefert.

## Controller

Verbinde deinen Xbox- oder PlayStation-Controller über USB oder Bluetooth mit Windows und drücke nach dem Verbinden eine Taste. Das Spiel erkennt die vom System gemeldete Gerätefamilie und zeigt passende Xbox- oder PlayStation-Symbole. Menüs, Einstellungen, Arsenal, Skilltree, Kisten, Rucksack, Lager und Markt sind mit dem Controller bedienbar. Text- und Preisfelder bieten eine Bildschirmtastatur; Einladungen lassen sich dort ausdrücklich aus der Zwischenablage einfügen.

| Aktion | Xbox | PlayStation |
| --- | --- | --- |
| Bewegen / Umsehen | Linker / rechter Stick | Linker / rechter Stick |
| Feuern / Zielen | RT / LT | R2 / L2 |
| Springen / Bestätigen | A | × |
| Ducken / Zurück | B | ○ |
| Nachladen | X | □ |
| Interagieren, Kisten öffnen | Y | △ |
| Heilen | LB | L1 |
| Rucksack | RB | R1 |
| Karte | View / Zurück | Share / Create |
| Pause / Fortsetzen | Menü | Options |
| Sprinten | Linken Stick drücken | L3 |
| Ducken, alternativ | Rechten Stick drücken | R3 |
| Menüauswahl | Steuerkreuz oder linker Stick | Steuerkreuz oder linker Stick |
| Menüregister wechseln | LB / RB | L1 / R1 |

Unter **Einstellungen → Controller** findest du zwölf Optionen: Raidsteuerung, Blick- und Visier-Empfindlichkeit, getrennte Stick-Totzonen, Reaktionskurve, invertierten Blick, Tastensymbole, Vibration sowie Halten/Umschalten für Zielen, Sprinten und Ducken. Die Menübedienung bleibt auch bei abgeschalteter Raidsteuerung verfügbar. Nach einem Abziehen oder Fensterwechsel werden gehaltene Eingaben verworfen; lasse Tasten und Sticks kurz los, bevor du fortsetzt. Ein Mausklick ins Spielfeld übernimmt wieder die Maussteuerung.

Unterstützt werden Controller, deren Treiber der Gamepad-API eine Standardbelegung liefert. Meldet etwa DS4Windows oder Steam Input einen PlayStation-Controller als Xbox-Gerät, kann das Spiel die verdeckte Hardwareidentität nicht auslesen. Wähle dann bei **Tastensymbole** manuell PlayStation. Vibration hängt von Controller, Verbindung und Treiber ab; DualSense-Spezialeffekte und adaptive Trigger sind nicht enthalten.

## Gegnerverhalten

Wachen nutzen erreichbare Deckung und treten kurz zum Schießen hervor. Flankierende Gegner versuchen seitliche Schusswinkel, während andere ihre Position halten. Nahe Wachen können einen beobachteten Kontakt weitergeben und verteilen sich bei der Suche. Treffer können einen Stellungswechsel auslösen.

Verlierst du den Sichtkontakt, untersuchen Gegner deine zuletzt beobachtete Position und suchen die Umgebung ab. Schüsse, Alarme und nahes Sprinten verraten eine ungefähre Geräuschposition; lautloses Bewegen hinter einer Wand verrät deinen neuen Aufenthaltsort nicht. Wege berücksichtigen Hindernisse und offene Gebäudeeingänge. Nach erfolgloser Suche kehren Wachen zur Patrouille zurück. Waffenhaltung und kurze Suchblicke machen ihre Aufmerksamkeit erkennbar.

Diese Verhaltensweisen gelten auch im Koop für beide Spieler. Wachen und Veteranen tragen mehr Schutz und halten mehr Körpertreffer aus; präzise Kopftreffer bleiben besonders wirkungsvoll. Der Boss **Kommandant Voss** wird von vier Leibwachen begleitet. Seine Gruppe deckt den Kommandanten und sucht gemeinsame Flanken. Höherwertige Gegner sind gefährlicher und können bessere Ausrüstung bei sich tragen.

Im Laufe des Raids rücken in Abständen von rund zweieinhalb Minuten weitere Patrouillen nach. Die aktive Gegnerzahl ist begrenzt; neue Gruppen erscheinen außerhalb unmittelbarer Spielernähe und sichtbarer Spawnpositionen. Schüsse veranlassen Gegner innerhalb ihrer Hörweite zur Untersuchung der Geräuschquelle. Ein Schalldämpfer reduziert diese Reichweite.

## Arsenal und Skilltree

Das **ARSENAL** enthält 32 Waffen, 36 Aufsätze und 24 Ausrüstungsteile. Waffen unterscheiden sich in Bauform, Schussrhythmus, Rückstoß, Reichweite, Klang und Nachladebewegung. Die acht bisherigen Waffen bleiben erhalten; 24 neue Modelle erweitern Maschinenpistolen, Sturm- und Bullpup-Gewehre, Schrotflinten, Präzisionsgewehre, Scharfschützengewehre, Maschinengewehre und Kurzwaffen.

Unter **FERTIGE KITS** wählst du eines von sechs fertig zusammengestellten Einsatzkits. Dein eigenes Loadout stellst du unter **AUSRÜSTUNG** zusammen. Fertige Kits werden einmal pro Raid bezahlt und können vor dem Einsatz nicht verändert werden. Ihre gestellte Ausrüstung ist nicht handelbar und wird nach dem Einsatz nicht ins Lager übernommen. Das kostenlose **Notfall · Scout** bleibt jederzeit verfügbar. Im Raid kannst du gestellte Teile durch echte Funde ersetzen.

Für dein **eigenes Kit** kaufst du Waffen, Aufsätze und Ausrüstung im **SHOP** oder findest sie in Kisten. Gekaufte Gegenstände landen im Lager. Unter **AUSRÜSTUNG** wählst du deine Waffeninstanz, Rucksack, Plattenträger, Schutzplatte, Helm und bis zu vier Medkits. Eine Schutzplatte benötigt einen Plattenträger. Der angezeigte Verbrauchspreis umfasst Reservemunition und die gewählten Medkits; deine besessene Ausrüstung wird nicht erneut gekauft.

In der **WAFFENBANK** wählst du eine besessene Waffe. Die 3D-Vorschau zeigt ihre tatsächlichen Anbauteile. Sechs Aufsatzbereiche bieten jeweils sechs Alternativen:

| Bereich | Beispiele und Wirkung |
| --- | --- |
| Visier | Offenes Visier, Reflex, Holografisch, Prisma und Zielfernrohr; Vergrößerung gegen Anschlagzeit |
| Magazin | Kurz, verlängert, Trommel, gekoppelt; Kapazität gegen Wechselzeit und Handling |
| Mündung | Bremse, Kompensator, Schalldämpfer, Choke; Rückstoß, Hörbarkeit und Garbe |
| Griff | Vertikal, Winkel, kurz, Zweibein; Kontrolle gegen Gewicht und Anschlagzeit |
| Schaft | Leicht, klappbar, gepolstert, Präzisionsschaft; Bewegung und Rückstoß |
| Lauf | Kurz, lang, schwer, kanneliert; Reichweite, Schaden und Handling |

Nur passende, besessene Aufsätze lassen sich montieren. Ein montierter Aufsatz wird Teil dieser Waffeninstanz; beim Abmontieren oder Ersetzen kehrt er ins Lager zurück. Die Vorschau vergleicht die abgeleiteten Werte vor und nach dem Wechsel. Dieselben Werte gelten im Solo und werden im Koop vom Host berechnet. Schalldämpfer verändern auch den Klang und die Reichweite, in der Bots den Schuss hören.

Sechs Rucksäcke bieten acht bis 24 Beuteplätze; ohne Rucksack bleiben vier Plätze. Skills kommen zusätzlich dazu. Sechs Plattenträger, sechs Schutzplatten und sechs Helme unterscheiden sich in Schutz und Bewegungstempo. Schutzteile behalten ihren Zustand. Im Raid kannst du tragbare Fundstücke über **Ausrüsten** anlegen und eigene getragene Teile abwerfen. Ein Wechsel zu weniger Stauraum wird abgelehnt, solange deine Beute nicht hineinpasst.

Bei erfolgreicher Extraktion kommen eigene mitgeführte Ausrüstung und Funde in die Anlieferung. Lagere sie vor dem nächsten Raid ein. Bei Tod, Aufgabe oder Verbindungsverlust geht die mitgenommene Ausrüstung verloren; im Koop kann dein Partner zurückgelassene Gegenstände bergen. Gesicherte Lagerware bleibt erhalten. Die frühere Waffenwahl war eine Auswahl für einen Einkauf pro Einsatz und wird nicht nachträglich zu kostenlosem Waffenbesitz.

Der **SKILLTREE** ersetzt den bisherigen Upgrade-Shop. Vier Äste enthalten je sechs Fähigkeiten mit sichtbaren Verbindungen und Voraussetzungen:

- **Kampf:** Schaden, schnelleres Nachladen und weniger Rückstoß.
- **Schutz:** Rüstung, bessere Heilung, Schadensminderung und mehr Lebenspunkte.
- **Feld:** Ausdauer, Regeneration, Bewegung, schnellere Versorgung und zusätzliche Medkits.
- **Logistik:** Rucksackplätze, schnellere Kistensuche, Reservemunition und kürzere Extraktion.

Du beginnst mit drei Skillpunkten. Alle 250 XP steigt dein Level und du erhältst einen weiteren Punkt. Ein normaler Gegner bringt 50 XP, ein Elitegegner 100 XP, das erstmalige Aufnehmen eines Handelsgegenstands 10 XP und eine erfolgreiche Extraktion 150 XP. Abwerfen und erneutes Aufnehmen vergibt keine zusätzlichen XP. Verdiente XP bleiben auch bei einem gescheiterten Raid erhalten. Normale Knoten kosten einen Punkt, Meisterschaften zwei und benötigen beide vorhergehenden Pfade. Freigeschaltete Fähigkeiten bleiben dauerhaft aktiv.

Bereits gekaufte Rüstungs-, Rucksack- und Waffenränge werden beim Laden automatisch in passende Skillknoten übernommen. Ihr Effekt bleibt erhalten, wird nicht doppelt angewendet und verbraucht keine der drei neuen Startpunkte. Credits, Lager und Einstellungen bleiben erhalten.

## Kisten und Beute

Sieben Kistentypen enthalten passende Beutepools: Werkzeug, Elektronik, Sanität, Munition, Vorräte, Industrie und Sicherheit. Sie stehen an Arbeitsplätzen, in Versorgungsbereichen, an Frachtplätzen und in den begehbaren Gebäuden. Die 100 Handelsgegenstände und bisherigen neun Waren bleiben erhalten. Passende Kisten enthalten zusätzlich nutzbare Waffen, Aufsätze oder Ausrüstung; Munitions- und Sanitätskisten liefern auch Verbrauchsmaterial.

Gehe nahe an eine Kiste und drücke **E**. Nach einer kurzen Suche kannst du Gegenstände einzeln oder mit **Alles nehmen** entnehmen. Im selben Fenster siehst du deinen Rucksack und kannst mit **Abwerfen** Platz schaffen. Escape oder die Schließen-Schaltfläche schließen die Kiste; Tab bewegt den Fokus zwischen ihren Schaltflächen. Während der Suche und beim Plündern läuft der Raid weiter.

Der Inhalt wird einmal je Raid bestimmt. Wiederholtes Öffnen würfelt ihn nicht neu. Im Koop teilen beide Spieler den Kisteninhalt; ein Gegenstand landet bei genau einem Spieler. Abgeworfene Gegenstände bleiben als aufnehmbare Beute in der Welt. Alle neuen Handelsgegenstände lassen sich extrahieren, einlagern und auf dem vorhandenen Markt verkaufen.

**Gefallene Gegner sind eigene durchsuchbare Behälter.** Gehe zur Leiche und drücke E oder Y / △. Munition wird aus ihrem Inventar entnommen; zusätzlich kannst du Waren, Medkits und gelegentlich nutzbare Waffen, Aufsätze oder Schutzteile finden. Normale Wachen haben geringe Chancen auf besondere Ausrüstung; Veteranen, Leibwachen und der Boss besitzen bessere Beutepools. Erneutes Öffnen erzeugt keine neue Beute.

## Begehbare Gebäude

Alle Häuser auf der Karte besitzen zugängliche Innenräume. Viele Gebäude haben zwei oder drei Geschosse, die über echte Treppen erreichbar sind. Laufe durch die offenen Türen hinein; ein Ladebildschirm ist nicht nötig. Wände, Geschossdecken und Einrichtung bieten Deckung. Schüsse, Sichtlinien und Beuteinteraktionen berücksichtigen die tatsächlichen Öffnungen und Höhen. Dieselben Räume stehen auch im Koop zur Verfügung.

Zum alten Industriekern kommen **Altdorf, Bergwerk, Nordwacht, Osthafen, Linden und Südhof**. Umfassungsmauern lenken den Zugang durch einzelne Tore. Straßen verbinden die Siedlungen über hügeliges Gelände; drei Brücken überqueren den Fluss. Tiefes Flusswasser ist keine Abkürzung: Benutze die Übergänge. Autos, Pickups, Lieferwagen und Laster haben eigene erkennbare Karosserien.

## Einstellungen

**EINSTELLUNGEN** in der Basis oder im Pausenmenü öffnet 67 Optionen in sieben Kategorien:

- **Grafik & Anzeige:** Qualitätsprofil, Renderauflösung, Schatten, Partikel, Helligkeit, Kontrast, Sättigung, Sichtfeld, FPS-Limit und Vollbild.
- **Kamera & Bewegung:** Kopfbewegung, Waffenschwanken, Treffererschütterungen, Visier-Zoom, Sprint-Sichtfeld und Waffenanzeige.
- **Maus & Spielweise:** normale und Visier-Empfindlichkeit, invertierte Y-Achse, Halten/Umschalten für Zielen, Sprint und Ducken sowie Nachladen ohne erneuten Schussversuch.
- **Controller:** Empfindlichkeit, Stick-Totzonen, Reaktionskurve, Geräte-Symbole, Vibration und Halten/Umschalten.
- **Tastenbelegung:** zwölf Bewegungs- und Aktionstasten. Eine Aktion anklicken und die gewünschte Taste drücken; belegte Tasten werden erklärt, Escape bricht die Eingabe ab. Escape für das Menü und F11 für Vollbild bleiben fest.
- **Audio:** Gesamtlautstärke, Waffen, Effekte, Schritte, Umgebung und Hinweise separat; Stummschaltung bei Fensterwechsel und Nachtmodus.
- **HUD & Fadenkreuz:** Größe und Deckkraft, Fadenkreuz mit Farb-/Größenvorschau, Treffer- und Schadensanzeigen, Kompass, Teamanzeige, Interaktionshinweise und FPS-Anzeige.

Die Suche findet Einstellungen über alle Kategorien. Änderungen wirken sofort und werden automatisch gespeichert; vorhandene Einstellungen früherer Versionen bleiben erhalten. Eine Kategorie lässt sich einzeln zurücksetzen, alle Einstellungen über einen zweiten Bestätigungsklick. Spielstände und Lager werden dabei nicht verändert. Beim Sprint-Umschalten beendet Erschöpfung den Sprint; nach Erholung erneut die Sprinttaste drücken. Im Koop läuft die Welt auch bei geöffneten Einstellungen weiter.

Die Renderauflösung wird bei hohen Bildschirm- und Windows-Skalierungen durch ein Speicherlimit begrenzt. Auflösungsänderungen werden zusammengefasst; die Menüwelt wird mit maximal 30 FPS gezeichnet. Nach einem Grafikkontextverlust stellt sich die Anzeige im selben Spiel wieder her. Ein vollständiger Rendererabsturz zeigt eine separate Seite zum Neustart mit reduzierter Auflösung, statt auf einem weißen Bildschirm stehenzubleiben.

## Solo-Raid

1. Scout-Kit und normale Schwierigkeit wählen, dann den Raid starten.
2. Die Kisten in der Nähe des Startpunkts durchsuchen. M öffnet die Karte mit sechs Ausgängen und den zusätzlichen Außenbezirken.
3. Deckung nutzen, auf Patrouillen achten und mit Munition haushalten.
4. An einer Extraktionszone E drücken und acht Sekunden in der Zone bleiben.
5. In der Basis unter **Lager** den Extraktionsrucksack einzeln oder mit **Alles einlagern** leeren. Vorher ist der nächste Raid gesperrt.
6. Unter **Markt** einen gelagerten Gegenstand auswählen, den Wunschpreis eingeben und eine Laufzeit von 2, 5 oder 10 Minuten wählen.
7. Unter **Postfach** Verkaufserlöse beanspruchen oder unverkaufte Waren wieder ins Lager holen. Credits finanzieren Kits und Waffen; XP liefern die Punkte für permanente Skills.

Die Runde dauert maximal 30 Minuten. Tod, Ablauf der Zeit oder Aufgabe verlieren die ungesicherte Beute und mitgenommene eigene Ausrüstung. Erfolgreich extrahierte Gegenstände bleiben erhalten; Abschuss- und Relaisboni werden direkt gutgeschrieben. Das Scout-Kit kostet nichts. Andere Fertigkits beziehungsweise Verbrauchsmaterial für eigene Kits werden beim Raidstart bezahlt. Kontostand, Skills, XP, Loadout, Waffenumbauten, Lager, Anlieferung, Angebote und Postfach werden lokal gespeichert. Ein laufender Raid wird beim Schließen nicht gespeichert.

## Markt und Rucksack

Mit **Tab** den Rucksack öffnen und bei einem Gegenstand **Abwerfen** klicken. Er liegt anschließend erreichbar in der Welt und kann mit E wieder aufgenommen werden. So wird sofort ein Platz frei. Tab, Escape oder die Schließen-Schaltfläche bringen dich zurück ins Spiel. Die Welt läuft während geöffneter Feldanzeigen weiter; Laufen und Schießen sind währenddessen gesperrt. Außerhalb dieser Anzeigen pausiert Escape den Einsatz.

Der Markt simuliert lokale Käufer und braucht keine Internetverbindung. Der Richtpreis schwankt kontinuierlich mit der Uhrzeit. Die erste Käuferprüfung findet nach 60–90 Sekunden statt, weitere alle 60 Sekunden. Zum aktuellen Richtwert beträgt die Chance 18 % pro Prüfung; günstigere Angebote erreichen höchstens 65 %. Ein hoher Wunschpreis senkt die Chance. Ab dem doppelten aktuellen Richtwert gibt es keine Käufer; beliebig hohe Preise haben keine verbleibende Mindestchance. Die Anzeige folgt dem aktuellen Markt und ist keine Verkaufsgarantie. Maximal 20 Angebote laufen gleichzeitig, Preise sind ganze Credits zwischen 1 und 1.000.000. Es fallen keine Gebühren an.

Verkaufte Angebote schicken exakt den gewählten Preis ins Postfach. Nach Ablauf unverkaufte oder manuell abgebrochene Angebote schicken den Gegenstand dorthin zurück. **Beanspruchen** übernimmt Credits bzw. lagert den Gegenstand ein. Beim nächsten Start wird verstrichene Zeit nachberechnet; dieselben Käuferprüfungen erhalten bei jedem Laden dasselbe Ergebnis. Es gibt keine echten Spieler oder externen Börsenkurse.

Seit Version 1.7.1 wächst das Guthaben langsamer: Neue Beutefunde sind 35 % weniger wert, hochwertige Gegenstände werden seltener gezogen. Die Kisten enthalten weiterhin drei bis fünf Handelsgegenstände sowie gegebenenfalls Munition oder Medkits. Bei erfolgreicher Extraktion gibt es 15 CR pro Abschuss, 150 CR für das Relais und mit Rückkehrplan zusätzlich 50 CR. XP und das kostenlose Scout-Kit bleiben davon unberührt. Vorhandene Credits, gesicherte Gegenstände und bereits abgerechnete Post bleiben erhalten; aktive Angebote folgen den neuen Käuferregeln.

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
- `src/weapons.js`: gemeinsame Werte, Feuerarten, Modellvarianten und Preise aller 32 Waffen.
- `src/loadouts.js`: Aufsätze, Ausrüstung, feste Kits, Besitzprüfung, Montage und abgeleitete Werte.
- `src/progression.js`: 24 Skillknoten, Voraussetzungen, XP, Effekte und Migration alter Upgrades.
- `src/armory-ui.js` / `src/progression-ui.js`: Kits, Ausrüstung, Waffenbank, Shop und interaktiver Skilltree.
- `src/recoil.js`: sanfte, begrenzte Rückstoßwinkel, gemeinsam für Kamera und Trefferberechnung.
- `src/layout.js`: gemeinsame Karte für Kollisionen, Darstellung und Übersicht.
- `src/terrain.js`, `src/world-layout.js`: deterministisches Höhenfeld, Fluss, Straßen, Brücken und mehrgeschossige Gebäude mit gemeinsamen Kollisionen und Laufhöhen.
- `src/world-render.js`: räumlich gebündelte Weltgeometrie und entfernungsabhängige Darstellung.
- `src/operator-stage.js`: 3D-Ausrüstungsraum mit dem gewählten Operator-Loadout im bestehenden Grafik-Kontext.
- `src/enemies.js`: Gegnerrollen, Verstärkungsgrenzen und Leichenbeute.
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

Eine 1.500 × 1.500 Meter große Karte mit vollständig begehbaren Gebäuden, sechs festen Einsatzkits, eigenem Loadout, 32 Waffen, 36 Aufsätzen, 24 Ausrüstungsteilen, zwei Schwierigkeiten und 24 permanenten Skills. Solo gegen KI oder privater Koop für genau zwei Spieler. Lager und Markt bleiben pro Spieler lokal; es gibt keinen gemeinsamen öffentlichen Handelsmarkt oder öffentliches Matchmaking. Modelle und Texturen werden lokal erzeugt. Die Sounds verwenden mitgelieferte Aufnahmen: echte M45- und AK-47-Schüsse als bearbeitete Klangbasis der Waffen, Airsoft-Nachlademechanik, Schritte auf hartem Boden und Wind.

Version 1.1.0 ersetzt die synthetischen Schüsse und Schritte. Schussvarianten wiederholen sich nicht unmittelbar; die beiden Waffen haben unterschiedliche Klangquellen. Gegnerklänge folgen Entfernung, Blickrichtung und Hindernissen. Schritte hängen von tatsächlicher Bewegung ab, Ducken ist leiser, Sprinten kräftiger. Pause und Tod brechen geplante Nachladegeräusche ab. Der Mixer begrenzt gleichzeitig aktive Stimmen und Spitzenpegel. `node scripts/qa-audio.mjs` prüft die echte Stereo-Ausgabe gegen den laufenden Vite-Server.

Version 1.2.0 ergänzt den vollständigen Lager-/Marktkreislauf und vergrößert die Kartenfläche um den Faktor 6,25. Der Rückstoß ist deutlich kleiner, vorhersehbar und kehrt nach einer Feuerpause vollständig zurück. Kamera und Schussrichtung verwenden dieselben Winkel; Zielen und Ducken reduzieren den Rückstoß zusätzlich.

Version 1.2.1 befestigt das Handgelenk-Display am Arm und korrigiert den Übergang zur Stützhand. Beide Waffen haben wieder etwas kräftigeren Rückstoß: stärkere Einzelimpulse und eine etwas langsamere Erholung ergeben spürbarere Feuerstöße. Die seitliche Bewegung bleibt gering; Kamera und Trefferberechnung bleiben aufeinander abgestimmt.

Version 1.2.2 behebt das schnelle Umschalten zwischen Sprint und Gehen bei leerer Ausdauer. Waffenhaltung, Laufbewegung und Sichtfeld gehen weich ineinander über. Nach Erschöpfung Shift einmal loslassen und mindestens 20 % Ausdauer regenerieren; anschließend ist Sprinten wieder möglich. Dauerhaft gehaltenes Shift startet nach Erschöpfung keinen neuen Sprint von allein.

## Technik und Quellen

Three.js (MIT), Rapier (Apache-2.0), Vite (MIT), Electron (MIT), Playwright (Apache-2.0), ws (MIT), yauzl (MIT), cloudflared (Apache-2.0). Die Lizenzdateien der Desktop-Laufzeit und der Tunnelkomponente liegen dem Windows-Paket bei. `vendor/cloudflared.json` fixiert Download, Version und SHA-256; das Buildskript prüft diese vor dem Verpacken. Technische Referenzen: [Three.js Renderer](https://threejs.org/docs/pages/WebGLRenderer.html), [Rapier Character Controller](https://rapier.rs/docs/user_guides/javascript/character_controller/), [GitHub Releases API](https://docs.github.com/en/rest/releases/releases) und [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

Debug-Zugriff ist nur im Entwicklungsserver oder beim expliziten Start mit `--qa` aktiv. Die normale Windows-Ausgabe veröffentlicht diese Teststeuerung nicht.
