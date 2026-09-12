# Dedicated server

The production service runs at `https://91.98.64.49` on a Hetzner CX23. Ubuntu runs
the Node.js service under the unprivileged `dead-frequency` account. Nginx is the
public TLS endpoint; the application listens only on `127.0.0.1:8080`. Inbound
public ports are 80 (certificate validation and HTTPS redirect) and 443
(accounts and WebSocket raids). SSH22 remains limited in the Hetzner firewall.

## Deploy

Run `python scripts/server-bundle.py` after tests. It emits a versioned tar.gz
with server/source code and exact installed `ws` and Rapier dependencies.
Extract into a new directory under `/opt/dead-frequency/releases/`, point the
`/opt/dead-frequency/current` symlink at it, then restart `dead-frequency.service`.
Do not replace the persistent database when updating code. Stop before switching
versions while a raid is active; a server restart ends active raids with already
committed equipment/costs retained as spent.

Environment: `/etc/dead-frequency.env`; example included here.
Data: `/var/lib/dead-frequency/accounts.sqlite` plus SQLite WAL/SHM files.
The database, session files, SSH keys and passwords must never enter a release.

## Operations

```sh
systemctl status dead-frequency nginx
journalctl -u dead-frequency --since '1 hour ago'
curl --fail https://91.98.64.49/health
systemctl list-timers dead-frequency-cert-renew.timer dead-frequency-backup.timer
```

Account names are case insensitive. Passwords use per-account salted scrypt;
only hashes of 30-day bearer sessions are stored. Server-owned action methods
validate purchases, skill unlocks, equipment and the existing probabilistic
market. Online profiles cannot be imported through public client APIs. Local
offline progress is a separate profile. Rooms consume server-owned equipment
before start and settle results once, before sending successful completion.

Room limit starts at two total rooms, each solo or two-player coop. Monitor actual
60Hz tick timings in `/health` and reduce `MAX_ROOMS` if the shared CPU cannot
sustain them. A room invitation alone is insufficient: each player also needs
an authenticated, single-use join ticket. No renderer or GPU runs on the VPS.

Version 1.13 adds persistent friendship edges through an additive SQLite schema
change. Existing accounts and profiles are preserved. Public lobby discovery only
shows available coop rooms and never exposes socket credentials. Friends lobbies
require a confirmed friendship with the current owner. In-game invitations are
ephemeral, expire after two minutes and do not reserve capacity. The 1.13 runtime
explicitly accepts 1.12 game clients during rollout because their raid protocol
and simulation are unchanged; all other versions still require an exact match.

## Certificates and backups

IP certificates use Let's Encrypt's shortlived profile. Certbot5.4+ is installed
in `/opt/dead-frequency-certbot`. The dedicated timer checks every six hours and
reloads Nginx after renewal. Keep port80 publicly reachable for this process.

A daily SQLite-consistent backup is integrity checked and retained for14days
under `/var/backups/dead-frequency`. These copies are on the same server; they
protect against accidental database changes, not complete loss of the VPS disk.
Restore only with the application stopped, preserving the current DB first.

## Password recovery

There is no email-based recovery yet. An administrator can reset a verified
owner's password over SSH without placing the password in shell history:

```sh
cd /opt/dead-frequency/current
node server/admin.js reset-password USERNAME
```

The command requests the password twice without echo and revokes old HTTP
sessions. Existing active raid sockets finish/disconnect separately.


## Separate game administration (1.14)

With the service database path configured, create or rotate a dedicated admin
credential from a trusted server terminal:

```sh
cd /opt/dead-frequency/current
sudo -u dead-frequency env DATA_PATH=/var/lib/dead-frequency/accounts.sqlite node server/admin.js set-admin ADMINNAME
```

The command prompts twice without echo. There is no default password; admin
passwords require 14–128 characters. Never commit credentials or include them in
release assets. Rotation invalidates existing admin sessions. Normal game
accounts, even with the same name, cannot authorize `/api/admin/*` routes.

Administration uses separate salted scrypt credentials and hashed 30-minute
sessions in additive SQLite tables. The Windows native process retains its admin
session only in memory, independently of the encrypted game login. The UI opens
with F8 in any phase. Account mutations respect active profile locks, actions
have strict bounded parameters and idempotency IDs, and the database retains a
bounded audit history. This interface cannot execute shell commands or JavaScript.

The 1.14 server accepts 1.13 clients during rollout: spawn positions are ordinary
world coordinates and the added raid/player snapshot fields are additive. The
new native admin interface requires 1.14. Both peers should update normally.
