# Mailroom

Webová aplikace pro **hromadné zpracování právní a obchodní pošty**. Navrženo pro advokáta / podnikatele v oblasti drahých kovů a fintech (Jurisconsult Ostrava). UI v češtině, návrhy odpovědí ve stejném jazyce jako přijatý email (CZ/EN/DE/SK).

## Co umí

- Připojení **IMAP** schránky (univerzální), nebo **Microsoft 365 / Outlook** přes OAuth, nebo **Gmail** přes OAuth.
- Hromadná synchronizace pošty do Supabase (Postgres + Storage).
- Skupinování zpráv do **vláken** podle hlaviček (`In-Reply-To` / `References` u IMAP, `conversationId` u Outlooku, `threadId` u Gmailu).
- Automatická **extrakce textu z příloh** (PDF přes `pdf-parse`, DOCX přes `mammoth`, scany a obrázky přes OCR `tesseract.js` s češtinou a angličtinou).
- **AI klasifikace** (smlouva / výzva / žádost / faktura / klient / interní / ostatní), shrnutí, klíčová fakta, detekce jazyka a priority.
- **Návrhy odpovědí** v jazyce přijatého emailu, profesionální právní tón.
- **Q&A nad přílohou** — odpověz na otázku v kontextu jednoho dokumentu.
- Odeslání návrhu zpět přes SMTP (IMAP účet), Microsoft Graph (Outlook) nebo Gmail API.

## Technologie

- **Frontend:** Vite + React + TypeScript + Tailwind + shadcn/ui (wouter pro hash routing)
- **Backend:** Node.js + Express
- **Databáze:** Supabase (Postgres) + Supabase Storage (privátní bucket `mailroom-attachments`)
- **AI:** Google Gemini (`gemini-2.5-flash`, výchozí), Anthropic Claude, OpenAI, Perplexity Sonar
- **Email:** `imapflow` + `mailparser`, `nodemailer`, `@googleapis`, Microsoft Graph REST
- **Bezpečnost:** AES-256-GCM pro hesla / OAuth tokeny

---

## 1) Rychlý start (lokálně, Docker)

### Předpoklady
- Účet na [Supabase](https://supabase.com/) (free tier stačí)
- Docker + Docker Compose
- Volitelně: Google Gemini API klíč ([aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)) nebo jiný AI provider

### Kroky

1. **Vytvoř Supabase projekt** a v SQL editoru spusť obsah souboru [`migration.sql`](./migration.sql). Tím se vytvoří tabulky `accounts`, `threads`, `messages`, `attachments`, `actions`.
2. **Vytvoř Storage bucket** `mailroom-attachments` (Dashboard → Storage → New bucket → název `mailroom-attachments`, **Public: OFF**).
3. **Stáhni si Service Role klíč** (Project Settings → API → `service_role` secret).
4. **Naklonuj repo a vytvoř `.env`** podle [`.env.example`](./.env.example):

   ```bash
   cp .env.example .env
   # vyplň SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   openssl rand -hex 32   # → MAILROOM_ENCRYPTION_KEY
   # PERPLEXITY_API_KEY (volitelné)
   ```

5. **Spusť přes Docker Compose:**

   ```bash
   docker compose up --build
   ```

   Aplikace běží na <http://localhost:5000>.

### Bez Dockeru (vývojový režim)

```bash
npm install
cp .env.example .env  # vyplň
npm run dev
```

Vývojový server na <http://localhost:5000> s hot-reloadem (Vite + Express na stejném portu).

---

## 2) Deploy na produkci

### Možnost A — Railway

Repo obsahuje `railway.json`, takže Railway použije konfiguraci z kódu:

- Build command: `npm ci --no-audit --no-fund && npm run build`
- Start command: `npm run start`
- Healthcheck: `/api/status`

V `Settings → Variables` doplň proměnné z `.env.example`. Po nasazení nastav `MS_REDIRECT_URI` a `GMAIL_REDIRECT_URI` na produkční URL (`https://<your-app>.up.railway.app/api/auth/...`). Podrobný postup je v [`RAILWAY_DEPLOY.md`](./RAILWAY_DEPLOY.md).

### Možnost B — Vlastní VPS

```bash
git clone <repo>
cd mailroom
cp .env.example .env  # vyplň
docker compose up -d --build
```

Před proxy (Caddy / nginx) přidej HTTPS termination a směruj na port 5000.

---

## 3) OAuth setup

### Microsoft 365 / Outlook

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name: `Mailroom`, Supported account types: **Personal & work/school accounts**.
3. Redirect URI: `Web` → `http://localhost:5000/api/auth/outlook/callback` (a později produkční URL).
4. Po vytvoření vlevo v menu:
   - **Authentication** → povolit `ID tokens` a `Access tokens`.
   - **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**: `Mail.Read`, `Mail.Send`, `offline_access`, `User.Read`. Pak **Grant admin consent**.
   - **Certificates & secrets** → **New client secret** → zkopíruj hodnotu do `MS_CLIENT_SECRET`.
   - **Overview** → zkopíruj **Application (client) ID** do `MS_CLIENT_ID`.
5. V `.env` vyplň `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI`.
6. V aplikaci → **Účty** → **Připojit Outlook**.

### Gmail / Google Workspace

1. [Google Cloud Console](https://console.cloud.google.com) → vytvoř projekt.
2. **APIs & Services** → **Library** → povol **Gmail API** a **People API**.
3. **OAuth consent screen** → External (nebo Internal pro Workspace), vyplň název, supportní email.
4. **Scopes**: přidej `gmail.readonly`, `gmail.send`, `gmail.modify`, `userinfo.email`, `userinfo.profile`.
5. **Test users** (pokud je app v testing režimu) → přidej svůj Gmail.
6. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
   - Authorized redirect URI: `http://localhost:5000/api/auth/gmail/callback` (+ produkční URL).
7. Zkopíruj `Client ID` → `GMAIL_CLIENT_ID`, `Client secret` → `GMAIL_CLIENT_SECRET`.
8. V aplikaci → **Účty** → **Připojit Gmail**.

---

## 4) IMAP setup (bez OAuth)

Když nechceš OAuth, použij univerzální IMAP/SMTP konektor s **app password**:

- **Gmail**: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → vytvoř app password (vyžaduje 2FA).
  - IMAP: `imap.gmail.com:993` (TLS)
  - SMTP: `smtp.gmail.com:587` (STARTTLS) nebo `:465` (SSL)
- **Outlook/Office 365**: [Microsoft account security](https://account.microsoft.com/security) → **App passwords** (pokud má účet 2FA).
  - IMAP: `outlook.office365.com:993`
  - SMTP: `smtp.office365.com:587`
- **Seznam.cz**: nastavení → app heslo
  - IMAP: `imap.seznam.cz:993`
  - SMTP: `smtp.seznam.cz:465`

V aplikaci → **Účty → Přidat IMAP účet**. Před uložením proběhne test přihlášení.

---

## 5) První sync

1. Otevři **Účty**, přidej účet (IMAP nebo OAuth).
2. U nového účtu klikni **Sync teď**. První sync stáhne posledních 90 dní (max 200 zpráv).
3. Pošta se objeví v **Inboxu**, AI klasifikace běží na pozadí (chvíli to může trvat).
4. V detailu vlákna klikni **Generovat AI** → vznikne návrh odpovědi. Můžeš ho upravit a **Odeslat**.

---

## 6) Datový model

Viz [`migration.sql`](./migration.sql). Tabulky:

- `accounts` — IMAP/OAuth účty, šifrovaná hesla a tokeny.
- `threads` — vlákna, AI metadata (kategorie, shrnutí, fakta, priorita, jazyk).
- `messages` — jednotlivé zprávy.
- `attachments` — přílohy + `extracted_text`, `ocr_used`.
- `actions` — AI návrhy odpovědí, Q&A historie.

---

## 7) Bezpečnost

- Hesla a OAuth tokeny jsou v DB **šifrované AES-256-GCM** (klíč z `MAILROOM_ENCRYPTION_KEY`).
- Supabase `service_role` klíč nikdy nevystavuj na frontendu — používá se výhradně backendem.
- Aplikace je MVP **single-user** (proměnná `MAILROOM_USER_ID`). Pro multi-user nasazení lze přidat Supabase Auth + RLS — tabulky už `user_id` mají.

---

## 8) AI provideři

Mailroom podporuje čtyři AI providery: **Google Gemini** (výchozí — nejlevnější), **Anthropic (Claude)**, **OpenAI (ChatGPT)** a **Perplexity (Sonar)**. Pokud není nastaven žádný API klíč, aplikace v sandboxu automaticky použije vestavěný platform proxy.

### Přehled providerů a modelů

| Provider | Dostupné modely | Kde získat API klíč |
|---|---|---|
| **Google Gemini** ⭐ (výchozí) | `gemini-2.5-flash` (výchozí), `gemini-2.5-pro`, `gemini-2.5-flash-lite` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| **Anthropic (Claude)** | `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| **OpenAI (ChatGPT)** | `gpt-4o`, `gpt-4o-mini`, `gpt-4.1` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Perplexity (Sonar)** | `sonar`, `sonar-pro` | [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) |

### Výchozí matice modelů

| Úloha | Výchozí provider | Výchozí model | Env proměnná pro přepsání |
|---|---|---|---|
| Klasifikace vlákna | gemini | gemini-2.5-flash | `AI_MODEL_CLASSIFY` |
| Návrh odpovědi | gemini | gemini-2.5-flash | `AI_MODEL_DRAFT` |
| Q&A nad přílohou | gemini | gemini-2.5-flash | `AI_MODEL_QA` |

Prioritní pořadí: `GEMINI_API_KEY` > `ANTHROPIC_API_KEY` > `OPENAI_API_KEY` > `PERPLEXITY_API_KEY` > platform proxy.

Gemini je nastaven jako výchozí provider, protože je **nejlevnější**. Lze kdykoli přepsat proměnnou `AI_PROVIDER` nebo per-task proměnnými.

### Proměnné prostředí

```env
# API klíče (stačí nastavit jeden)
GEMINI_API_KEY=AIza...        # doporučeno — nejlevnější
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PERPLEXITY_API_KEY=pplx-...

# Globální výchozí provider (gemini | anthropic | openai | perplexity)
AI_PROVIDER=gemini

# Globální výchozí model (volitelný přepis výchozího modelu provideru)
AI_MODEL=gemini-2.5-flash

# Per-task modely (přepíší AI_MODEL)
AI_MODEL_CLASSIFY=gemini:gemini-2.5-flash
AI_MODEL_DRAFT=gemini:gemini-2.5-flash
AI_MODEL_QA=gemini:gemini-2.5-flash
```

Formát hodnot per-task je `provider:model` (doporučeno) nebo jen `model` (aplikace odvodí provider z prefixu).

### Přepis modelu z UI

V zobrazení vlákna (sekce **Návrh odpovědi**) i přílohy (sekce **Otázky nad dokumentem**) je k dispozici rozbalovací nabídka pro výběr konkrétního modelu pro daný jeden požadavek. Nabídka zobrazuje pouze nakonfigurované providery (s nastaveným API klíčem). Výběr se neukládá – jde o jednorázový přepis.

### Endpoint pro stav AI

```
GET /api/ai/config
```

Vrátí JSON s přehledem nakonfigurovaných providerů, dostupných modelů a výchozích nastavení pro každou úlohu.

---

## 9) Endpointy (přehled)

- `GET /api/status` — co je nakonfigurováno
- `GET|POST|DELETE /api/accounts(/:id)`
- `POST /api/accounts/:id/sync`, `GET /api/accounts/:id/sync/status`
- `GET /api/auth/outlook/start` + `/callback`
- `GET /api/auth/gmail/start` + `/callback`
- `GET /api/threads` (filtry: `category`, `unread`, `priority`, `attachments`, `account_id`, `q`)
- `GET /api/threads/:id`, `PATCH`, `POST /resummarize`
- `POST /api/threads/:id/draft-reply`, `POST /api/threads/:id/send`
- `GET /api/attachments/:id/preview`, `/download`, `POST /qa`
- `GET /api/ai/config` — stav AI providerů, dostupné modely, výchozí nastavení

---

## 10) Filtry synchronizace

Každý účet může mít nastavené per-account filtry, které určují, co se při synchronizaci stáhne a uloží.

### Dostupné filtry

| Pole | Typ | Popis |
|---|---|---|
| `sync_since_date` | datum (YYYY-MM-DD) | Stahovat pouze zprávy od tohoto data. Pokud není vyplněno, výchozí = posledních 90 dní. |
| `excluded_addresses` | seznam | Přeskočit zprávy od těchto adres nebo domén. |
| `excluded_subjects` | seznam | Přeskočit zprávy, jejichž předmět obsahuje některé z těchto slov (substring, case-insensitive). |

### Příklady

**Datum od:**
```
2025-01-01  →  stáhne pouze zprávy z roku 2025 a novější
```

**Vyloučit adresy:**
```
noreply@seznam.cz        →  přeskočí exact match
newsletter.com           →  přeskočí vše z *@newsletter.com
*@marketing.example.com  →  také přeskočí vše z dané domény
```

**Vyloučit slova v předmětu:**
```
newsletter      →  přeskočí předměty obsahující "newsletter" (case-insensitive)
unsubscribe
auto-reply
```

### Jak nastavit

1. Při přidávání IMAP účtu — rozbal sekci **Filtry synchronizace (volitelné)** a vyplň požadovaná pole.
2. U existujícího účtu — klikni na tlačítko **Filtry** u daného účtu v seznamu. Otevře se dialog pro úpravu.

Filtry se aplikují na úrovni zpracování každé zprávy (před uložením do DB). Zprávy odpovídající filtrům se nepřidají ani do vláken.

### REST endpoint

```
PATCH /api/accounts/:id
  { sync_since_date?, excluded_addresses?, excluded_subjects?, name? }
```

---

## 11) Známá omezení / roadmap

- Sync je manuální (tlačítko **Sync teď**). Pro plánovaný sync přidejte cron / Railway scheduler.
- Pro multi-user je třeba doplnit Supabase Auth + RLS politiky.
- OCR (`tesseract.js`) běží uvnitř Node procesu a je CPU-náročný. Pro produkci zvažte přesun do dedikovaného workeru.
- AI volání mají limity: max 30 000 znaků na vlákno, 20 000 znaků na přílohu (truncate v aplikační vrstvě).

---

## 10) Licence

Soukromé použití. Není určeno k veřejnému poskytování bez vlastní autentizace.

---

## 11) Datovka — analýza datových zpráv (Czech Data Mailbox / ISDS)

### Co modul dělá

Modul **Datovka** slouží k ručnímu nahrání a analýze zpráv z české datové schránky (ISDS). Umožňuje:

- Nahrát ZFO soubory (formát Datové schránky) nebo holé PDF soubory stažené z portálu `mojedatovaschranka.cz`
- Automaticky extrahovat metadata ze ZFO obálky (XML): odesílatel, adresát, ID zprávy, datum doručení, předmět
- Extrahovat text z PDF příloh (s OCR fallbackem pro skenované dokumenty)
- AI klasifikaci: typ instituce, typ podání, spisová značka, shrnutí, klíčová fakta, detekce lhůt
- Barevné kódování lhůt (červená < 7 dní, oranžová 7–14 dní)
- Správu více datových schránek (multi-mailbox)

### Jak nahrát ZFO/PDF

1. Klikněte na **Datovka** v levém menu
2. Klikněte na **Nahrát ZFO/PDF** (tlačítko vpravo nahoře)
3. Přetáhněte nebo vyberte soubory (`.zfo`, `.pdf`) — max 10 souborů, max 50 MB každý
4. Vyberte cílovou datovou schránku (doporučeno)
5. Klikněte **Nahrát a analyzovat** — systém soubory zpracuje, extrahuje text a spustí AI analýzu

### Jak fungují schránky (multi-mailbox)

Klikněte na **Schránky** (tlačítko vedle Nahrát). Přidejte novou schránku:
- **Název** (povinný) — např. "Profigold s.r.o." nebo "Jurisconsult Ostrava"
- **ID datové schránky** — alfanumerický identifikátor z ISDS (nepovinný, pro přehled)
- **IČO** (nepovinné)
- **Poznámky** (nepovinné)

Zprávy můžete filtrovat podle schránky v horním dropdownu.

### AI klasifikace + detekce lhůt

Po nahrání systém automaticky provede:

1. **Klasifikace instituce**: Soud / Exekutor / Regulátor / Úřad / Finanční úřad / Ministerstvo / Jiný
2. **Typ podání**: Žaloba / Usnesení / Výzva / Oznámení / Faktura / Rozhodnutí / Jiný
3. **Spisová značka** (č.j. / sp. zn.) — extrahovaná z textu
4. **Priorita**: Vysoká (lhůty < 14 dní, exekuce, žaloby) / Normální / Nízká
5. **Shrnutí** — 2–4 věty česky
6. **Klíčová fakta** — 3–6 bodů (částky, lhůty, jména)
7. **Lhůta** — detekce data lhůty (absolutní i relativní "za 15 dnů od doručení")

Reklasifikaci lze spustit znovu přes menu **⋮ → Reklasifikovat** nebo v detailu zprávy.

### Limity

- **Manuální nahrávání** — neexistuje automatická synchronizace s ISDS API. Soubory je třeba stáhnout z portálu `mojedatovaschranka.cz` a nahrát ručně.
- **ZFO formát** — parser je defensivní; pokud se nepodaří parsovat XML obálku, soubory jsou uloženy jako přílohy a metadata jsou prázdná.
- **Velikost souborů** — max 50 MB na soubor, max 10 souborů v jednom nahrávání.
- **OCR** — tesseract.js pro skenované PDF; CPU-náročný, může trvat déle.



## GoldDesk Communicator

Projekt je rozšířen o modul `/#/communicator`, který pomáhá s bezpečnou komunikací s klienty a reakcemi na recenze. Umí vygenerovat e-mail, SMS, WhatsApp text, telefonní skript, interní checklist, rizikovou kontrolu, HTML kód a veřejnou odpověď na recenzi. Detailní návod je v `COMMUNICATOR_README.md`.

## Online přístup k datové schránce / ISDS

Modul **Datovka** nyní podporuje také online synchronizaci přijatých datových zpráv přes PHP knihovnu `dfridrich/czech-data-box`.

### Co je doplněno

- `scripts/databox_bridge.php` – PHP bridge volaný z Node backendu.
- `composer.json` – PHP závislost `dfridrich/czech-data-box`.
- `server/datovka/live-client.ts` – server-side synchronizace ISDS.
- UI v `/#/datovka → Schránky` – login, heslo, test přístupu, synchronizace.
- Rozšíření `migration.sql` o šifrované přihlašovací údaje a sync metadata.

### Důležité

Railway musí použít Dockerfile, protože aplikace potřebuje zároveň Node.js i PHP SOAP runtime. `railway.json` je proto nastaven na builder `DOCKERFILE`.

Přístupové údaje k ISDS jsou ukládány pouze v Supabase v šifrované podobě (`login_enc`, `password_enc`) přes `MAILROOM_ENCRYPTION_KEY`. Service role key ani hesla nesmí být ve frontendu ani v GitHubu.

### Railway proměnné

```env
PHP_BINARY=php
ISDS_CACHE_DIR=/tmp/GoldDeskDataBox
DATABOX_BRIDGE_PATH=/app/scripts/databox_bridge.php
```

Tyto hodnoty už mají default v Dockerfile, ale můžeš je v Railway přepsat.

## GoldDesk Communicator – PDF/HTML analýza dokumentů

Modul `/communicator` nově podporuje nahrání PDF, HTML/HTM, TXT/MD souboru nebo vložení HTML/textu přímo do aplikace. Endpoint `/api/communicator/analyze-document` z dokumentu vytěží text, rozpozná typ komunikace, riziko, fakta, chybějící údaje a předvyplní formulář pro generování e-mailu, SMS, WhatsApp textu, telefonního skriptu, HTML kódu nebo reakce na recenzi.

Detailní návod je v `COMMUNICATOR_DOCUMENT_IMPORT_README.md`.
