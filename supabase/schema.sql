-- 4221-Games · Supabase-Setup (Online-Schach mit Uhr + Chat, Online-Imposter)
-- In Supabase: SQL Editor → New query → alles einfügen → Run
-- Das Skript kann gefahrlos mehrfach ausgeführt werden. Es löscht keine Spieldaten.

-- ───────── Schach ─────────
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

-- Erweiterungen für Uhr, Namen und Chat (für bestehende Datenbanken)
alter table public.chess_games add column if not exists white_name   text;
alter table public.chess_games add column if not exists black_name   text;
alter table public.chess_games add column if not exists tc_base      integer;   -- Sekunden, leer = Arbeitsmodus
alter table public.chess_games add column if not exists tc_inc       integer not null default 0;
alter table public.chess_games add column if not exists white_ms     integer;   -- Restzeit Weiß beim letzten Zug
alter table public.chess_games add column if not exists black_ms     integer;
alter table public.chess_games add column if not exists last_move_at timestamptz not null default now();

-- Zeitpunkt des letzten Zuges setzt der Server (verhindert Uhren-Tricks und Zeitzonen-Probleme)
create or replace function public.chess_touch() returns trigger language plpgsql as $$
begin
  if new.pgn is distinct from old.pgn then
    new.last_move_at := now();
  end if;
  return new;
end $$;
drop trigger if exists chess_touch on public.chess_games;
create trigger chess_touch before update on public.chess_games
  for each row execute function public.chess_touch();

create table if not exists public.chess_chat (
  id          uuid primary key default gen_random_uuid(),
  game_id     text not null references public.chess_games(id) on delete cascade,
  sender      text not null,
  name        text,
  body        text not null check (char_length(body) between 1 and 300),
  created_at  timestamptz not null default now()
);
create index if not exists chess_chat_game on public.chess_chat (game_id, created_at);

-- ───────── Imposter ─────────
create table if not exists public.imposter_rooms (
  id          text primary key,                 -- 5-stelliger Raumcode
  host        text not null,                    -- Browser-ID des Hosts
  phase       text not null default 'lobby',    -- lobby | playing | voting | result
  settings    jsonb not null default '{}',
  round       jsonb,                            -- aktuelle Runde (Wort, Rollen, Ergebnis)
  score       jsonb not null default '{"civ":0,"imp":0}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.imposter_players (
  room_id     text not null references public.imposter_rooms(id) on delete cascade,
  client_id   text not null,
  name        text not null,
  vote        text,                             -- client_id der verdächtigten Person
  joined_at   timestamptz not null default now(),
  primary key (room_id, client_id)
);

-- ───────── Zugriff (ohne Login, für alle mit Link) ─────────
-- Neuere Supabase-Projekte geben neue Tabellen nicht mehr automatisch frei.
-- Diese Zeilen erlauben der Website den Zugriff.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.chess_games      to anon, authenticated;
grant select, insert, update, delete on public.chess_chat       to anon, authenticated;
grant select, insert, update, delete on public.imposter_rooms   to anon, authenticated;
grant select, insert, update, delete on public.imposter_players to anon, authenticated;

alter table public.chess_games      enable row level security;
alter table public.chess_chat       enable row level security;
alter table public.imposter_rooms   enable row level security;
alter table public.imposter_players enable row level security;

do $$
declare t text;
begin
  foreach t in array array['chess_games', 'chess_chat', 'imposter_rooms', 'imposter_players'] loop
    execute format('drop policy if exists "open read"   on public.%I', t);
    execute format('drop policy if exists "open insert" on public.%I', t);
    execute format('drop policy if exists "open update" on public.%I', t);
    execute format('drop policy if exists "open delete" on public.%I', t);
    execute format('create policy "open read"   on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "open insert" on public.%I for insert to anon, authenticated with check (true)', t);
    execute format('create policy "open update" on public.%I for update to anon, authenticated using (true) with check (true)', t);
    execute format('create policy "open delete" on public.%I for delete to anon, authenticated using (true)', t);
    -- Live-Updates aktivieren
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Alte Policies aus der ersten Version entfernen (falls vorhanden)
drop policy if exists "chess read"   on public.chess_games;
drop policy if exists "chess insert" on public.chess_games;
drop policy if exists "chess update" on public.chess_games;

-- Optional: alte Spiele/Räume aufräumen – bei Bedarf manuell ausführen
-- delete from public.chess_games    where updated_at < now() - interval '7 days';
-- delete from public.imposter_rooms where updated_at < now() - interval '2 days';
