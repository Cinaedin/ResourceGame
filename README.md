# ResourceGame
AFK Næring ressurslek

# Prioriteringsspill – Næringsavdelingen (Pilot)

Dette repoet inneholder et enkelt, men engasjerende minispill for å gjøre prioriteringer synlige:

- **Tid (prosent av personer)** allokeres til oppgaver via **drag & drop**
- **Penger (NOK-tokens)** kan allokeres til oppgaver via **drag & drop**
- Budsjettmidler kan ha **regler/avgrensninger** (øremerking, min/maks, formål) som er **redigerbare i Editor**
- Deltakere kjører en **one-shot** og leverer en **logg**
- Ledelsen ser aggregert resultat i **Dashboard**

Dette er en **pilot og læringsøvelse**, ikke et budsjett-/beslutningssystem.

---

## Roller

### Editor (før workshop)
- Definerer **mål → programmer → oppgaver**
- Legger inn **ansatte + kapasitet**
- Legger inn **budsjettlinjer** (stat / handlingsrom)
- Legger inn **budsjettregler** (redigerbar JSON + ferdige maler)
- Importerer fra **CSV** (oppgaver, folk, budsjett, regler)
- Kan **låse scenario** når alt er klart
- Kan **reset scenario** (sletter kun innspill)

### Player (under workshop)
- Skriver inn navn
- Allokerer **5%-tidschips** fra personer til oppgaver (drag & drop)
- Allokerer **NOK-tokens** fra budsjettlinjer til oppgaver (drag & drop)
- Ser live:
  - overbelastning av personer
  - budsjettforbruk og gjenstående midler
  - regelvarsler (øremerking/min/maks/splitt osv.)
- Sender inn anbefaling → logg lagres

### Dashboard (etter workshop)
- Aggregert ranking:
  - tid per oppgave
  - tid per program (mål nivå 2)
  - budsjett per oppgave
  - ofte utelatte oppgaver
- Liste over alle innsendinger + loggtekst
- Eksport til CSV

---

## Hosting (ingen IT-tilgang nødvendig) – GitHub Pages (gratis)

### Steg-for-steg (for dummies)

1. Opprett GitHub-konto
2. Lag et public repo, f.eks. `akershus-prioriteringsspill`
3. Opprett disse filene i repoets rot:
   - `index.html`
   - `app.js`
   - `dashboard.html`
   - `dashboard.js`
   - `config.js`
   - `schema.sql`
   - (valgfritt) `seed_2026.sql`
   - `README.md` (denne filen)
4. Gå til **Settings → Pages**
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. GitHub viser en URL som f.eks.:
   - `https://DITTBRUKERNAVN.github.io/akershus-prioriteringsspill/`

Åpne URL-en → du skal se appen.

---

## Bruk i Teams (valgfritt)

I Teams:
1. Gå til Team → Kanal
2. Trykk **+** (legg til fane)
3. Velg **Website**
4. Lim inn GitHub Pages-URL
5. Kall fanen «Prioriteringsspill 2026»

Hvis Teams åpner i nettleser i stedet for innebygd – helt OK i pilot.

---

## Backend (Supabase) – gratis

1. Lag Supabase-prosjekt (free tier)
2. Kjør `schema.sql` i Supabase SQL Editor
3. For pilot: slå **RLS OFF** på tabellene (Table Editor → RLS)
4. (Valgfritt) Kjør `seed_2026.sql` for å opprette et scenario med eksempeldata

### Koble frontend til Supabase
Åpne `config.js` og fyll inn:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SCENARIO_ID`

Da slipper du å lime inn verdier i UI hver gang.

---

## CSV import (Editor)

Du kan importere CSV med **komma eller semikolon**. Header-row må være med. Appen viser preview før import.

### People (folk)
Headers:
- `name`
- `capacity_pct` (0–100)

### Budsjettlinjer
Headers:
- `title`
- `type` (`stat` eller `handlingsrom`)
- `amount_nok`

### Oppgaver (tasks)
Headers:
- `level1_goal` (strategisk mål)
- `program` (portefølje/program)
- `task_title`
- `tags` (kommaseparert, f.eks. `STARTUP,INNOVASJON`)
- `notes`

Appen auto-oppretter mål/program hvis de ikke finnes.

### Regler (rules)
Headers:
- `budget_title`
- `rule_type`
- `rule_json` (JSON, f.eks. `{"tags":["STARTUP"]}`)

---

## Budsjettregler (eksempler)

Regler er **soft constraints**: spillet advarer, men lar deg sende inn (for å få fram reelle prioriteringer).

Vanlige regler:
- `allowed_tags`  → `{"tags":["STARTUP","BREDDBAND"]}`
- `required_tags` → `{"tags":["STARTUP"]}`
- `min_spend`     → `{"nok":2000000}`
- `max_spend`     → `{"nok":5000000}`
- `min_spend_on_tag` → `{"tag":"STARTUP","nok":2000000}`
- `max_spend_on_tag` → `{"tag":"ADMIN","nok":500000}`
- `min_share_on_tag` → `{"tag":"STARTUP","share":0.25}`
- `max_share_on_tag` → `{"tag":"ADMIN","share":0.15}`
- `required_split`   → `{"splits":[{"tag":"STARTUP","min_share":0.3},{"tag":"ADMIN","max_share":0.15}]}`
- `must_spend_all`   → `{"must":true}`
- `locked`           → `{"locked":true}`
- `geo_constraint`   → `{"text":"Må stimulere startups i Akershus"}`
- `note`             → `{"text":"Forklaring som vises til spillere"}`

---

## Reset scenario (Editor)

Reset sletter kun:
- playthroughs, allokeringer og logger

Scenario-data beholdes:
- mål, oppgaver, personer, budsjettlinjer og regler

Bruk reset før ny workshop.

---

## 1-side intern forklaring (til kolleger)

### Hva er dette?
En prioriteringsøvelse der du simulerer hvordan avdelingen kan fordele:
- Folks tid
- Midler (med øremerking/regler)

### Hva skal jeg gjøre?
- Alloker tid og eventuelt budsjett slik du mener gir mest effekt
- Aksepter at vi **ikke kan gjøre alt**
- Se på advarsler som informasjon (ikke feil)
- Send inn anbefalingen din

### Hva brukes innspillene til?
- Innsendingene brukes til å se **mønstre** (hva prioriteres, hva velges bort)
- Det finnes ingen fasit
- Dette er ikke en evaluering av personer

### Hva dette IKKE er
- Ikke bindende plan
- Ikke budsjettvedtak
- Ikke ytelsesmåling

---

## Neste steg (når pilot er bevist)
Hvis dette fungerer bra:
- Flytt hosting til offisiell plattform
- Skru på innlogging + RLS
- Begrens Editor-tilgang
- Bruk dashboard som beslutningsstøtte
