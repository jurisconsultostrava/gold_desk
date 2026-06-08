# Deploy Mailroom na GitHub + Railway

Tento repozitář je upravený tak, aby šel bezpečně nahrát na GitHub a nasadit na Railway přes Nixpacks.

## 1) Co je v této verzi opraveno

- odstraněna nativní závislost `better-sqlite3`, která zbytečně rozbíjela instalaci na hostingu,
- opravená TypeScript chyba v `server/ai.ts` — zdvojený `switch`,
- opravené typové chyby v IMAP ingestu a ZFO parseru,
- doplněný `railway.json` pro Railway build/start/healthcheck,
- doplněný `Procfile`,
- doplněný Node engine `20.x`,
- `.env` je ignorovaný pro GitHub,
- doplněná Supabase migrace pro Datovku (`datovka_mailboxes`, `datovka_messages`, `datovka_attachments`) a storage bucket `datovka-files`.

## 2) Lokální kontrola před pushnutím

```bash
npm ci
npm run check
npm run build
npm run start
```

Lokálně aplikace běží standardně na:

```text
http://localhost:5000
```

Healthcheck endpoint:

```text
/api/status
```

## 3) GitHub

```bash
git init
git add .
git commit -m "Prepare Mailroom for Railway deployment"
git branch -M main
git remote add origin https://github.com/<TVUJ_UCET>/<REPO>.git
git push -u origin main
```

Nikdy necommituj `.env`. V této verzi je `.env` v `.gitignore`.

## 4) Supabase

V Supabase projektu spusť celý soubor:

```text
migration.sql
```

V SQL editoru Supabase se tím vytvoří:

- `accounts`
- `threads`
- `messages`
- `attachments`
- `actions`
- `datovka_mailboxes`
- `datovka_messages`
- `datovka_attachments`
- storage buckets `mailroom-attachments` a `datovka-files`

Potom si v Supabase zkopíruj:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Service role key patří pouze do Railway Variables, nikdy ne do frontendu ani GitHubu.

## 5) Railway

V Railway:

1. New Project → Deploy from GitHub repo.
2. Vyber repozitář.
3. Railway použije `railway.json`:
   - build: `npm ci --no-audit --no-fund && npm run build`
   - start: `npm run start`
   - healthcheck: `/api/status`
4. Vlož environment variables.

Povinné proměnné:

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx
SUPABASE_STORAGE_BUCKET=mailroom-attachments
MAILROOM_ENCRYPTION_KEY=64_HEX_ZNAKU
MAILROOM_USER_ID=default-user
NODE_ENV=production
```

Vygenerování šifrovacího klíče:

```bash
openssl rand -hex 32
```

AI provider — stačí jeden:

```env
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
PERPLEXITY_API_KEY=
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
```

OAuth volitelně:

```env
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_REDIRECT_URI=https://<tvoje-app>.up.railway.app/api/auth/outlook/callback

GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REDIRECT_URI=https://<tvoje-app>.up.railway.app/api/auth/gmail/callback
```

Proměnnou `PORT` v Railway nenastavuj ručně. Railway ji poskytuje automaticky.

## 6) Po nasazení

Ověř:

```text
https://<tvoje-app>.up.railway.app/api/status
```

Musí vrátit JSON s `ok: true`.

Potom otevři hlavní URL aplikace a nastav účty.

## 7) Rizika / omezení

- Aplikace je MVP single-user přes `MAILROOM_USER_ID`; není to ještě plnohodnotný multi-user systém.
- `SUPABASE_SERVICE_ROLE_KEY` má vysoká oprávnění. Railway projekt musí být chráněný a klíč nesmí být nikde ve veřejném repozitáři.
- OAuth callback URL musí přesně odpovídat produkční Railway URL.
- Datovka modul předpokládá nahrávání ZFO/PDF souborů, ne přímé napojení na ISDS API.

## Poznámka k datové schránce

Nová verze obsahuje PHP bridge pro ISDS (`dfridrich/czech-data-box`). Railway musí použít Dockerfile. V `railway.json` je nastaven builder `DOCKERFILE`.

Po nasazení ověř:

```text
/api/status
```

V odpovědi má být `databox_bridge: true`.

Pak v aplikaci otevři:

```text
/#/datovka
```

Klikni na `Schránky`, ulož přístupové údaje, proveď `Test` a následně `Sync`.

## Vstupní autentizace do aplikace

Aplikace nyní podporuje jednoduché přihlášení jménem a heslem ještě před vstupem do Mailroom / GoldDesk UI.

### Railway Variables

Nastav v Railway:

```env
APP_AUTH_ENABLED=true
APP_AUTH_USERNAME=admin
APP_AUTH_PASSWORD=sem_dej_silne_heslo
APP_SESSION_SECRET=dlouhy_nahodny_retezec_minimalne_32_znaku
APP_COOKIE_SECURE=true
```

Bezpečnější varianta je nepoužívat prosté heslo, ale hash:

```bash
npm run auth:hash -- "moje-silne-heslo"
```

Výstup vlož do Railway jako:

```env
APP_AUTH_PASSWORD_HASH=scrypt:...
```

Pak v Railway smaž `APP_AUTH_PASSWORD`.

### Chování

- bez přihlášení se zobrazí login obrazovka,
- API endpointy kromě `/api/status` a `/api/app-auth/*` jsou chráněné session cookie,
- odhlášení je v levém dolním menu ikonou odhlášení,
- session platí standardně 12 hodin (`APP_SESSION_MAX_AGE_MS=43200000`).

Pokud testuješ produkční build lokálně přes obyčejné `http://`, nastav dočasně:

```env
APP_COOKIE_SECURE=false
```

Na Railway/HTTPS ponech `APP_COOKIE_SECURE=true`.

