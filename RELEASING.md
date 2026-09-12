# Eine neue Version veröffentlichen

Der Launcher bezieht ausschließlich stabile Releases aus `easycrashx-nex/dead-frequency`. Ein neuer Git-Commit allein löst noch kein Spielupdate aus.

1. `package.json` auf eine höhere Version setzen. Beide Mitspieler benötigen dieselbe Version; der Koop-Client übernimmt sie beim Build automatisch.
2. `pnpm install --frozen-lockfile`, `pnpm prepare:tunnel`, `pnpm test`, `pnpm build`, `pnpm package` ausführen.
3. Die neue Windows-Ausgabe mit `node scripts/qa-online-native.mjs` gegen den aktualisierten dedizierten Server prüfen. Er verwendet zwei isolierte Windows-Instanzen und private QA-Accounts. Zugangsdaten in `accounts.private.json` bleiben ausschließlich im ignorierten QA-Ordner. Der lokale Koop-Regressionslauf ist `node scripts/qa-coop-native.mjs`. Die übrigen gezielten Prüfungen passend zur Änderung ausführen.
4. `python scripts/release.py --qa-report ../qa-online-native-<VERSION>/result.json` erzeugt das vollständige Windows-ZIP, den Quellcode und `SHA256SUMS.txt`. Bei einem ausschließlich lokalen Koop-Release stattdessen den passenden `qa-coop-native`-Bericht angeben.
5. Geprüfte Quelldateien committen und pushen. Auf genau diesen Commit ein stabiles Release `v<VERSION>` erstellen; dabei `DEAD-FREQUENCY-Windows.zip`, `DEAD-FREQUENCY-Quellcode.zip`, `SHA256SUMS.txt` und `ANLEITUNG.md` hochladen. Die Releasebeschreibung über `gh release create --notes-file <Datei>` übergeben.
6. Release erst veröffentlichen, wenn alle Assets vollständig hochgeladen sind. Das öffentliche Downloadpaket mit dem Updater erneut prüfen.

Der Name des Windows-Assets ist Teil des Updatevertrags. Das ZIP muss den kompletten Ordner `DEAD FREQUENCY-win32-x64` enthalten. Sein `update-manifest.json` bindet Versionsnummer und EXE-Namen. Der Launcher verifiziert den GitHub-Assetdigest bzw. die SHA-256-Datei und alle Dateien der gecachten Installation.

Historische Releases bleiben erhalten. Keine Zugangsdaten, Testprofile, temporären Einladungslinks oder Laufzeitlogs committen. Cloudflared wird beim Build ausschließlich aus der fest versionierten offiziellen Quelle geladen und gegen den hinterlegten SHA-256 geprüft.

`node scripts/qa-ai-native.mjs` beobachtet die taktische KI in der neuen Windows-EXE: echte Deckung und Peek-Wechsel, seitliches Flankieren, einen tatsächlich abgefeuerten Schuss hinter einer Wand sowie anschließende Suche durch den Lagereingang. Kontrollierte Testpositionen und erhöhte Spieler-Lebenspunkte erlauben längere Beobachtung; die Simulation läuft dabei in Echtzeit. `node scripts/qa-ai-performance-native.mjs` misst anschließend 15 Sekunden mit maximal 72 aktiven Gegnern auf hoher Grafik bei 1440 × 900. Native Grafikprüfungen nacheinander ausführen. Der Koop-Test prüft zusätzlich, dass ein Schuss des zweiten Spielers die gemeinsame Host-KI informiert und beide Clients dasselbe Suchverhalten sehen.

Bei Änderungen an Einstellungen prüft `node scripts/qa-settings-native.mjs` die neue EXE einschließlich Migration, aller 67 Optionen, Tastenbelegung, Vollbild und Bedienung im Raid. Für den echten automatischen Versionswechsel nach der Veröffentlichung `DF_QA_BASELINE_EXE` auf die EXE einer früheren veröffentlichten Version setzen und `node scripts/qa-launcher-handoff.mjs` ausführen. Dieser Test verwendet ein isoliertes Profil, übernimmt Fortschritt und bestehende Einstellungen und prüft den Neustart ohne Benutzereingriff.

`node scripts/qa-controller-native.mjs` prüft Controller-Eingaben in der echten Windows-EXE mit kontrollierten Gamepad-API-Daten. Der Bericht kennzeichnet diese ausdrücklich als simulierte Eingaben; er ersetzt keinen Test physischer USB-/Bluetooth-Controller oder Vibrationsmotoren. Geprüft werden Geräteerkennung, Neutralstellung, Menüs, Einstellungen, analoge Raidsteuerung, Aktionen, Abziehen, Fensterwechsel und Rückkehr zu Maus/Tastatur. Der Koop-Test verwendet zusätzlich simulierte Xbox-Sticks und Trigger des zweiten Windows-Clients gegen den echten Internet-Host. Native Prüfungen nacheinander ausführen.

`node scripts/qa-world-native.mjs` prüft die neue 1500-Meter-Welt, Gebäudezutritt, Treppen, Brücken und Leichenbeute in der Windows-Ausgabe. `qa-interiors-native.mjs` dokumentiert die historische Fünf-Gebäude-Karte. Nach Änderungen an gemeinsamer Weltgeometrie zusätzlich den Koop-Test ausführen, der auch den Gebäudezutritt beider Spieler und gemeinsame Innenraumbeute überprüft.

`node scripts/qa-containers-native.mjs` prüft alle sieben Kistentypen, Öffnen und Suchen, Entnehmen und Abwerfen sowie die Weitergabe neuer Gegenstände an Lager, Markt und Postfach in der paketierten Windows-EXE. Der Koop-Test prüft gleichzeitig geöffnete Kisten und die Vergabe eines Gegenstands an genau einen Spieler.

`node scripts/qa-loadouts-native.mjs` prüft den aktuellen Ablauf in der Windows-EXE: Migration, feste Kaufkits, Shop, Montage in allen sechs Aufsatzbereichen, Ausrüstung, echte Waffenwerte, Schießen/Nachladen/Visier, Gearfunde und Wechsel, unbewaffnete Spieler, Extraktion, Zustand und Tod. Der Koop-Test kauft und montiert unterschiedliche eigene Waffen auf beiden Clients und prüft ihre Werte, sichtbaren Aufsätze und persönlichen Rückgewinn. `qa-progression-native.mjs` dokumentiert den historischen Auswahlablauf von 1.7; der aktuelle Loadout-Test ersetzt ihn für neue Releases. Skillgraph und alle Waffenfeuerarten bleiben in den Unit-Tests abgedeckt. Der Launcher-Handoff prüft bei einem alten Spielstand zusätzlich die Übernahme gekaufter Upgrade-Ränge in den Skilltree.

`node scripts/qa-economy-native.mjs` prüft neue Beutewerte, reduzierte Extraktionsboni, Markthinweise und Käuferintervalle, erfolglose Fantasiepreise, Rückgabe und einmalige Verkäufe in der Windows-EXE. Marktzeit wird für den Offline-Nachlauf gezielt vorgeschoben. Alte gesicherte Waren und Credits müssen beim Neuladen ihren Wert behalten; der Launcher-Handoff prüft zusätzlich ihren Erhalt beim echten Versionswechsel.



`node scripts/qa-stability-native.mjs` prüft echte Auflösungswechsel mit hoher Windows-Pixeldichte, drei Minuten Menüruhe, erzwungenen WebGL-Kontextverlust mit Erhalt des laufenden Raids sowie die eigenständige Wiederherstellungsseite nach einem nativen Rendererabsturz. Der Koop-Test enthält zusätzlich konkurrierende Leichenbeute und echtes Halten/Unterbrechen der sechssekündigen Wiederbelebung über den Internet-Host.
