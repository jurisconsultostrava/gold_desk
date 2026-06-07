# GoldDesk – online přístup k datové schránce přes ISDS

Modul Datovka nově podporuje dva režimy:

1. **Ruční upload ZFO/PDF** – původní bezpečný režim.
2. **Online synchronizace ISDS** – připojení přes PHP knihovnu `dfridrich/czech-data-box`.

## Proč je v projektu PHP

Aplikace je Node/React, ale knihovna `dfridrich/CzechDataBox` je PHP knihovna pro komunikaci s datovou schránkou. Proto je přidán malý bridge:

```text
scripts/databox_bridge.php
```

Node backend ho volá server-side přes PHP CLI. Přístupové údaje nejdou do frontendu.

## Railway / Docker

Railway musí použít `Dockerfile`, protože runtime musí obsahovat:

- Node.js,
- PHP CLI,
- PHP SOAP/XML rozšíření,
- Composer vendor knihovny.

V `railway.json` je nastaven builder `DOCKERFILE`.

## Supabase migrace

Po deployi spusť v Supabase celý `migration.sql`. Přidá mimo jiné sloupce:

- `datovka_mailboxes.login_enc`
- `datovka_mailboxes.password_enc`
- `datovka_mailboxes.live_access_enabled`
- `datovka_mailboxes.is_test`
- `datovka_mailboxes.sync_status`
- `datovka_mailboxes.last_sync_at`

Přihlašovací údaje se ukládají šifrovaně pomocí `MAILROOM_ENCRYPTION_KEY`.

## Railway Variables

Povinné:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
MAILROOM_ENCRYPTION_KEY=
NODE_ENV=production
```

Volitelné:

```env
PHP_BINARY=php
ISDS_CACHE_DIR=/tmp/GoldDeskDataBox
DATABOX_BRIDGE_PATH=/app/scripts/databox_bridge.php
```

## Použití v aplikaci

1. Otevři `/#/datovka`.
2. Klikni na `Schránky`.
3. Přidej nebo uprav schránku.
4. Zaškrtni `Povolit online přístup k datové schránce přes ISDS`.
5. Vyplň login a heslo.
6. Klikni `Uložit`.
7. Klikni `Test`.
8. Klikni `Sync`.

## Bezpečnostní poznámka

Nepoužívej hlavní osobní přístup jednatele, pokud to není nutné. Vhodnější je samostatný pověřený uživatel s řízeným oprávněním. Datové zprávy mohou mít právní účinky doručení a práce s nimi musí být auditovatelná.
