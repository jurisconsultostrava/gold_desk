# GoldDesk Communicator – analýza PDF / HTML dokumentů

Tato verze doplňuje do modulu **Communicator** automatickou analýzu podkladů, aby nebylo nutné ručně vyplňovat celý formulář.

## Co lze vložit

V aplikaci otevři:

```text
/#/communicator
```

V horní kartě **Analýza PDF / HTML dokumentu** lze použít:

- PDF soubor,
- HTML / HTM soubor,
- TXT / Markdown soubor,
- vložený HTML kód stránky,
- vložený text e-mailu, recenze, reklamace nebo právní výzvy.

## Co aplikace udělá

Backend dokument zpracuje server-side:

1. PDF přečte přes `pdf-parse`, u slabého textového výstupu zkusí OCR.
2. HTML očistí od skriptů/stylů a převede na čitelný text.
3. Text pošle do AI analýzy.
4. AI vrátí strukturované zadání pro komunikaci.
5. Formulář se automaticky předvyplní.
6. Uživatel může kliknout na **Vygenerovat komunikaci**, nebo použít tlačítko **Analyzovat + generovat**.

## Nový backend endpoint

```text
POST /api/communicator/analyze-document
```

Multipart form-data:

```text
file        PDF/HTML/TXT soubor, volitelné
html_text   vložený HTML/text, volitelné
mode_hint   auto | client | review
provider    volitelné
model       volitelné
```

Vrací:

```json
{
  "ok": true,
  "filename": "...",
  "mime_type": "...",
  "ocr_used": false,
  "text_preview": "...",
  "form_patch": {
    "mode": "client",
    "situation_type": "complaint",
    "risk_level": "high"
  },
  "analysis": {
    "summary": "...",
    "extracted_facts": [],
    "missing_information": [],
    "risks": [],
    "suggested_action": "...",
    "confidence": "medium"
  }
}
```

## Bezpečnostní zásady

- AI nesmí vymýšlet fakta, termíny, částky ani právní závěry.
- U rizikových dokumentů nastavuje vysoké/kritické riziko.
- Výstupy pro Gold Deposit, odměny, refundace, advokáty, banky, AML a regulátory vyžadují schválení.
- Extrahovaný text se používá jako podklad pro odpověď, ale před odesláním je nutná kontrola faktů.

## Railway

Není potřeba žádná nová proměnná prostředí. Používá se stávající AI konfigurace:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
AI_MODEL_DRAFT=gemini:gemini-2.5-flash
GEMINI_API_KEY=...
```

## Poznámka k PDF

Pokud je PDF pouze špatně naskenovaný obrázek, OCR nemusí být přesné. V takovém případě je lepší vložit text ručně do pole **Nebo vlož HTML/text dokumentu**.
