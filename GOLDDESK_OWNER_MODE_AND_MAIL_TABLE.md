# GoldDesk – Owner Mode, styl odpovědí a tabulka pošty

Tato verze upravuje komunikátor tak, aby primárně nepůsobil jako sterilní compliance filtr, ale jako praktický poradce majitele firmy.

## Komunikátor – nové chování

Primární cíl každé odpovědi:

1. udržet zákazníka,
2. obnovit důvěru,
3. ochránit značku,
4. nezhoršit právní pozici,
5. dostat komunikaci zpět pod kontrolu konkrétním dalším krokem.

## Nové ovladače stylu

V modulu `/#/communicator` přibyl blok **Styl výstupu**:

- **Kreativita** – od věcné odpovědi po osobnější obchodní formulaci,
- **Formálnost** – od civilního tónu po formální dopis,
- **Lidskost / empatie** – od stručné odpovědi po vztahovější omluvu,
- **Režim majitele** – výchozí režim pro osobní používání vedením,
- **Rizika jen jako doporučení** – rizika se zobrazí, ale výstup neblokují.

## Odstranění tvrdého filtru

Původní schvalovací logika byla zmírněna. Rizikové body se dál zobrazují v záložce **Rizika**, ale systém už nemá působit jako blokující regulační filtr. U citlivých případů stále doporučuje ověřit fakta, ale výstup připraví.

## Nový Inbox – tabulka pošty

V modulu pošty je nově tabulka s těmito sloupci:

- Datum,
- Naléhavost,
- Termín,
- Odesílatel / klient,
- Předmět a shrnutí,
- Kategorie,
- Stav.

Řazení funguje kliknutím na hlavičky:

- **Datum** – nejnovější / nejstarší,
- **Naléhavost** – kritické a vysoké případy nahoře,
- **Termín** – nejbližší termíny nahoře.

Termín se odhaduje z předmětu, shrnutí a klíčových faktů. Rozpoznává např.:

- `dnes`,
- `zítra`,
- `pozítří`,
- `do 3 dnů`,
- `12. 6. 2026`,
- `2026-06-12`.

Naléhavost se počítá z priority, kategorie, klíčových slov a blízkosti termínu. Riziková slova zahrnují např. advokát, předžalobní výzva, ČNB, FAÚ, banka, AML, reklamace, refundace, Gold Deposit, odměna, výnos.

## Supabase

Tato úprava nevyžaduje novou databázovou migraci. Tabulka pošty pracuje s existujícími poli:

- `threads.last_message_at`,
- `threads.priority`,
- `threads.category`,
- `threads.summary`,
- `threads.key_facts`,
- `threads.subject`,
- `threads.is_read`.
