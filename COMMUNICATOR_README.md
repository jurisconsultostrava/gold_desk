# GoldDesk Communicator

Tento balíček rozšiřuje původní Mailroom o modul **GoldDesk Communicator**.

## Co přibylo

- stránka `/#/communicator` v levém menu,
- režim **klientská komunikace**,
- režim **reakce na recenze**,
- generování výstupů:
  - e-mail,
  - SMS,
  - WhatsApp,
  - telefonní skript,
  - interní poznámka,
  - kontrolní checklist,
  - riziková analýza,
  - HTML kód,
  - veřejná odpověď na recenzi,
- import recenzí z vloženého HTML,
- ukládání výstupů do Supabase historie,
- fallback šablony pro případ, že AI klíč není nastaven.

## Deploy na Railway

1. Nahraj projekt na GitHub.
2. V Railway vytvoř nový projekt z GitHub repozitáře.
3. Nastav Variables podle `.env.example`.
4. V Supabase spusť celý `migration.sql`.
5. Ověř endpoint:

```text
/api/status
```

6. Otevři aplikaci a přejdi na:

```text
/#/communicator
```

## Důležité bezpečnostní pravidlo

`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ani jiné tajné klíče nikdy nepatří do GitHubu. Patří pouze do Railway Variables.

## Poznámka k HTML výstupu

HTML je generováno s inline CSS a bez externích skriptů, aby šlo vložit do e-mailového nástroje, Shoptetu nebo interního náhledu.
