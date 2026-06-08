# GoldDesk Strategic Dashboard

Tato verze přidává řídicí centrum aktivit.

## Nová výchozí obrazovka

Po přihlášení se otevře cesta:

```text
/#/
```

Ta nyní zobrazuje strategický dashboard místo běžného inboxu.

## Co dashboard sleduje

- prioritní položky z e-mailů,
- datové zprávy,
- návrhy odpovědí z Communicatoru,
- věci po termínu,
- termíny dnes / zítra,
- rizikovou komunikaci,
- nepřečtené zprávy,
- výstupy čekající na rozhodnutí,
- chyby synchronizace účtů.

## Nový API endpoint

```text
GET /api/dashboard/strategic
```

Endpoint vrací sjednocený manažerský přehled bez nové databázové migrace.
Pokud některý modul nemá hotovou migraci, dashboard nespadne, pouze zobrazí varování.

## Pošta

Původní tabulka pošty je nově na:

```text
/#/inbox
```

Kategorie a filtry v levém menu vedou do pošty.

## Datovka 500 fix

Endpoint:

```text
GET /api/datovka/mailboxes
```

byl upraven tak, aby při chybě schématu nevracel obecné 500 a neshazoval obrazovku.
Pokud chybí tabulky/sloupce, vrátí prázdné pole a přidá interní warning.

## Bez nové migrace

Tato verze nevyžaduje novou Supabase migraci.
Doporučené je ale mít spuštěný aktuální `migration.sql`, jinak dashboard u datovky zobrazí neúplná data.
