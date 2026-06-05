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
