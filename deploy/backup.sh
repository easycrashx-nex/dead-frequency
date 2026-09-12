#!/bin/sh
set -eu
umask 077
database=/var/lib/dead-frequency/accounts.sqlite
directory=/var/backups/dead-frequency
test -f "$database"
mkdir -p "$directory"
backup="$directory/accounts-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
/usr/bin/sqlite3 "$database" ".backup '$backup'"
test "$(/usr/bin/sqlite3 "$backup" 'PRAGMA integrity_check;')" = ok
# Only this service's backups expire; the live database is outside this directory.
find "$directory" -maxdepth 1 -type f -name 'accounts-*.sqlite' -mtime +14 -delete
