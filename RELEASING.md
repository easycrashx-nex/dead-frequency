# Eine neue Version veröffentlichen

Der Launcher bezieht ausschließlich stabile Releases aus `easycrashx-nex/dead-frequency`. Ein neuer Git-Commit allein löst noch kein Spielupdate aus.

1. `package.json` auf eine höhere Version setzen. Beide Mitspieler benötigen dieselbe Version; der Koop-Client übernimmt sie beim Build automatisch.
2. `pnpm install --frozen-lockfile`, `pnpm prepare:tunnel`, `pnpm test`, `pnpm build`, `pnpm package` ausführen.
3. Die neue Windows-Ausgabe mit `node scripts/qa-coop-native.mjs` prüfen. Der Test verwendet zwei isolierte Windows-Instanzen und benötigt Internet. Die übrigen gezielten Prüfungen passend zur Änderung ausführen.
4. `python scripts/release.py --qa-report ../qa-coop-native-<VERSION>/result.json` erzeugt das vollständige Windows-ZIP, den Quellcode und `SHA256SUMS.txt`.
5. Geprüfte Quelldateien committen und pushen. Auf genau diesen Commit ein stabiles Release `v<VERSION>` erstellen; dabei `DEAD-FREQUENCY-Windows.zip`, `DEAD-FREQUENCY-Quellcode.zip`, `SHA256SUMS.txt` und `ANLEITUNG.md` hochladen. Die Releasebeschreibung über `gh release create --notes-file <Datei>` übergeben.
6. Release erst veröffentlichen, wenn alle Assets vollständig hochgeladen sind. Das öffentliche Downloadpaket mit dem Updater erneut prüfen.

Der Name des Windows-Assets ist Teil des Updatevertrags. Das ZIP muss den kompletten Ordner `DEAD FREQUENCY-win32-x64` enthalten. Sein `update-manifest.json` bindet Versionsnummer und EXE-Namen. Der Launcher verifiziert den GitHub-Assetdigest bzw. die SHA-256-Datei und alle Dateien der gecachten Installation.

Historische Releases bleiben erhalten. Keine Zugangsdaten, Testprofile, temporären Einladungslinks oder Laufzeitlogs committen. Cloudflared wird beim Build ausschließlich aus der fest versionierten offiziellen Quelle geladen und gegen den hinterlegten SHA-256 geprüft.

Bei Änderungen an Einstellungen prüft `node scripts/qa-settings-native.mjs` die neue EXE einschließlich Migration, aller 55 Optionen, Tastenbelegung, Vollbild und Bedienung im Raid. Für den echten automatischen Versionswechsel nach der Veröffentlichung `DF_QA_BASELINE_EXE` auf die EXE einer früheren veröffentlichten Version setzen und `node scripts/qa-launcher-handoff.mjs` ausführen. Dieser Test verwendet ein isoliertes Profil, übernimmt Fortschritt und bestehende Einstellungen und prüft den Neustart ohne Benutzereingriff.

`node scripts/qa-interiors-native.mjs` prüft die begehbaren Gebäude in der neuen Windows-Ausgabe. Nach Änderungen an gemeinsamer Weltgeometrie zusätzlich den Koop-Test ausführen, der auch den Gebäudezutritt beider Spieler und gemeinsame Innenraumbeute überprüft.
