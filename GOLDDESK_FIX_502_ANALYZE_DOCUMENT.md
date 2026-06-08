# Fix 502 pro /api/communicator/analyze-document

Tato verze opravuje opakovaný Railway 502 při analýze PDF/HTML dokumentu.

## Co bylo změněno

- PDF se už neparsuje přímo v hlavním Node procesu.
- PDF parsing běží v odděleném child procesu `scripts/pdf_extract_child.mjs`.
- Pokud PDF parser spadne, timeoutuje nebo spotřebuje příliš paměti, nespadne hlavní backend.
- Endpoint `/api/communicator/analyze-document` má tvrdý fallback a vrací JSON odpověď i při technické chybě.
- Upload chyby z Multeru se vrací jako čitelná JSON chyba, ne jako obecná backendová chyba.

## Doporučené Railway proměnné

```env
ENABLE_OCR=false
PDF_PARSE_TIMEOUT_MS=15000
PDF_PARSE_MAX_BYTES=12582912
DOCUMENT_EXTRACT_TIMEOUT_MS=20000
COMMUNICATOR_ANALYSIS_TIMEOUT_MS=30000
COMMUNICATOR_UPLOAD_MAX_BYTES=26214400
COMMUNICATOR_FIELD_MAX_BYTES=10485760
PDF_CHILD_NODE_OPTIONS=--max-old-space-size=256
```

## Poznámky

- OCR je záměrně vypnuté. Zapínat až na silnějším hostingu.
- Skenované PDF bez textové vrstvy nemusí jít přečíst bez OCR. V takovém případě aplikace nespadne, ale vrátí nouzový formulář.
- Textová PDF a HTML/TXT vstupy jsou podporované normálně.
