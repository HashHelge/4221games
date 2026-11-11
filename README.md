# 4221-Games

Kleine Spieleseite für die Abteilung. Reines HTML/CSS/JS ohne Build-Schritt, läuft direkt auf GitHub Pages.

**Spiele**
- **Schach**: lokal an einem Gerät oder online zu zweit per 5-stelligem Code oder Link.
- **Imposter**:
  - *Online*: Jede:r spielt am eigenen Handy. Raum erstellen, Code teilen, Rolle erscheint auf dem eigenen Gerät, Abstimmung im Spiel.
  - *Ein Handy*: Pass-and-Play, das Gerät geht reihum.

Die Online-Funktionen laufen über Supabase (kostenlos).

## 1 · Auf GitHub online stellen

1. Neues Repository anlegen, z. B. `4221-games` (Public).
2. Den **Inhalt** dieses Ordners hochladen (*Add file → Upload files*), Ordnerstruktur beibehalten.
3. *Settings → Pages* → Source: **Deploy from a branch**, Branch `main`, Ordner `/ (root)` → **Save**.
4. Nach 1–2 Minuten ist die Seite unter `https://<dein-name>.github.io/4221-games/` erreichbar.

Ohne Supabase funktionieren schon: Imposter mit einem Handy und lokales Schach.

## 2 · Supabase für die Online-Funktionen

1. Auf [supabase.com](https://supabase.com) registrieren (am einfachsten mit dem GitHub-Konto).
2. **New project**: Name `4221-games`, Datenbank-Passwort vergeben, Region **Frankfurt (eu-central-1)**. 1–2 Minuten warten.
3. Links **SQL Editor → New query** → kompletten Inhalt von `supabase/schema.sql` einfügen → **Run**. Es muss „Success“ erscheinen.
4. **Project Settings → API Keys** (bzw. *API*): **Project URL** und den **anon**- bzw. **publishable**-Key kopieren.
5. In GitHub `js/config.js` öffnen → Stift-Symbol → beide Werte eintragen → **Commit changes**:
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_KEY = "dein-key";
   ```
6. Nach 1–2 Minuten die Seite neu laden. Fertig.

Hinweise:
- Der anon/publishable Key darf öffentlich sein. In der Datenbank liegen nur Spieldaten.
- Wer technisch versiert ist, kann im Browser die Rollen der Runde auslesen. Fürs Büro-Spiel egal.
- Kostenlose Projekte pausieren nach ca. 1 Woche ohne Nutzung → im Supabase-Dashboard auf **Restore** klicken.
- `schema.sql` darf mehrfach ausgeführt werden (z. B. nach Updates).

## So läuft Online-Imposter

1. Eine Person wählt *Imposter → Online*, gibt ihren Namen ein und tippt **Neuen Raum erstellen**. Sie ist der Host.
2. Die anderen öffnen den Einladungslink oder geben den Code ein.
3. Der Host stellt Imposter-Anzahl und Kategorien ein und startet die Runde (ab 3 Personen).
4. Jede:r tippt auf die eigene Karte. Dann wird reihum geredet, angefangen bei der angezeigten Person.
5. Der Host startet die Abstimmung. Wenn alle abgestimmt haben, wird automatisch aufgelöst.
6. Wird ein Imposter am meisten gewählt, gewinnen die Zivilisten. Errät der Imposter danach noch das Wort, tippt der Host **Imposter hat das Wort erraten**.

Verlässt der Host den Raum, übernimmt automatisch die nächste Person.

## Struktur

```
index.html               Startseite
schach.html              Schach
imposter.html            Imposter (beide Modi)
css/style.css            Design (Farben oben unter :root)
js/config.js             Supabase-Zugangsdaten
js/common.js             Hilfsfunktionen
js/schach.js             Schach
js/imposter.js           Imposter, ein Handy
js/imposter-online.js    Imposter, online
js/woerter.js            Wortpaare
supabase/schema.sql      Datenbank-Setup
```

## Wörter erweitern

In `js/woerter.js` Paare ergänzen: `["Wort A", "ähnliches Wort B"]`. Welches davon das „echte“ ist, wird pro Runde zufällig entschieden.
