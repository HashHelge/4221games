# 4221-Games

Kleine Spieleseite für die Abteilung. Reines HTML/CSS/JS – kein Build-Schritt, läuft direkt auf GitHub Pages.

**Spiele**
- **Schach** – lokal an einem Gerät oder online zu zweit (per 5-stelligem Code / Link, über Supabase Realtime)
- **Imposter** – Pass-and-Play an einem Handy. Zivilisten bekommen ein Wort, Imposter ein ähnliches. Anzahl Imposter, Kategorien und Hinweiswort einstellbar.

## 1 · Auf GitHub online stellen

1. Neues Repository anlegen, z. B. `4221-games` (öffentlich).
2. Alle Dateien aus diesem Ordner hochladen (*Add file → Upload files*, Ordnerstruktur beibehalten).
3. *Settings → Pages* → Source: **Deploy from a branch**, Branch: `main`, Ordner: `/ (root)` → Save.
4. Nach ca. 1 Minute ist die Seite unter `https://<dein-name>.github.io/4221-games/` erreichbar.

Imposter und lokales Schach funktionieren damit sofort.

## 2 · Online-Schach mit Supabase (optional)

1. Auf [supabase.com](https://supabase.com) kostenloses Projekt anlegen.
2. *SQL Editor → New query* → Inhalt von `supabase/schema.sql` einfügen → **Run**.
3. *Project Settings → API* (bzw. *API Keys*): **Project URL** und **anon / publishable key** kopieren.
4. In `js/config.js` eintragen:
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_KEY = "eyJ…  oder  sb_publishable_…";
   ```
5. Committen – fertig. Unter *Schach → Spiel erstellen* bekommt man einen Code, den der Gegner unter *Beitreten* eingibt (oder einfach den Link schicken).

> Der anon/publishable Key ist öffentlich gedacht. Die Tabelle ist bewusst ohne Login offen – fürs Büro völlig ok, aber keine sensiblen Daten darin speichern.

## Struktur

```
index.html          Startseite
schach.html         Schach
imposter.html       Imposter
css/style.css       Design
js/config.js        Supabase-Zugangsdaten
js/common.js        Hilfsfunktionen (Supabase, Toast …)
js/schach.js        Schachlogik (nutzt chess.js per CDN)
js/imposter.js      Imposter-Logik
js/woerter.js       Wortpaare – hier neue Wörter/Kategorien ergänzen
supabase/schema.sql Datenbank-Setup
```

## Wörter erweitern

In `js/woerter.js` einfach Paare ergänzen: `["Wort für Zivilisten", "ähnliches Wort für Imposter"]`. Welches der beiden Wörter „echt“ ist, wird pro Runde zufällig entschieden.

## Neues Spiel hinzufügen

Neue `xyz.html` anlegen (Kopf von `imposter.html` kopieren) und in `index.html` eine weitere `game-card` eintragen.
