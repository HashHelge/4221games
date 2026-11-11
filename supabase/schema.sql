-- 4221-Games · Supabase-Setup für Online-Schach
-- In Supabase: SQL Editor → New query → alles einfügen → Run

create table if not exists public.chess_games (
  id          text primary key,                 -- 5-stelliger Spielcode
  white       text,                             -- Browser-ID Spieler Weiß
  black       text,                             -- Browser-ID Spieler Schwarz
  fen         text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  pgn         text not null default '',
  result      text,                             -- '1-0' | '0-1' | '½-½'
  reason      text,                             -- Schachmatt, Aufgabe, Patt …
  rematch     text,                             -- Code des Revanche-Spiels
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.chess_games enable row level security;

-- Kein Login nötig: jede:r mit dem Link darf lesen/erstellen/ziehen.
drop policy if exists "chess read"   on public.chess_games;
drop policy if exists "chess insert" on public.chess_games;
drop policy if exists "chess update" on public.chess_games;
create policy "chess read"   on public.chess_games for select to anon, authenticated using (true);
create policy "chess insert" on public.chess_games for insert to anon, authenticated with check (true);
create policy "chess update" on public.chess_games for update to anon, authenticated using (true) with check (true);

-- Live-Updates aktivieren
alter publication supabase_realtime add table public.chess_games;

-- Optional: alte Spiele (älter als 7 Tage) aufräumen – bei Bedarf manuell ausführen
-- delete from public.chess_games where updated_at < now() - interval '7 days';
