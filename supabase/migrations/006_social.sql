-- Faz 3A: özel mesajlar, engelleme, şikâyet, küfür filtresi, saygı puanı.
-- Mağaza şartı (Apple 1.2 / Google UGC): içerik filtresi + şikâyet + engelleme + moderasyon kaydı.

-- ─────────────── İstemciye açık fonksiyonların tek listesi ───────────────
-- Her migration yeni RPC'lerini buraya ekler ve apply_grants() çağırır.
create table api_rpcs (sig text primary key);
alter table api_rpcs enable row level security;
insert into api_rpcs values
  ('get_state()'), ('create_player(text)'), ('do_crime(text)'), ('steal_car()'), ('sell_car(bigint)'),
  ('travel(text)'), ('trade(text, integer)'),
  ('buy_bullets(integer)'), ('buy_weapon(text)'), ('hire_bodyguard()'), ('practice()'), ('heal()'),
  ('hire_detectives(text, integer)'), ('shoot(text, integer)'), ('get_jail()'), ('bust(text)'), ('self_bust()'),
  ('bank_move(bigint)'), ('send_money(text, bigint)'), ('get_profile(text)'), ('get_players()'),
  ('create_family(text)'), ('apply_family(text)'), ('cancel_application()'), ('answer_application(text, boolean)'),
  ('leave_family()'), ('kick_member(text)'), ('set_role(text, text)'), ('family_deposit(bigint)'), ('family_pay(text, bigint)'),
  ('post_family_message(text)'), ('buy_factory()'), ('set_factory_price(integer)'), ('place_bounty(text, bigint)'),
  ('get_hitlist()'), ('get_family()'), ('get_families()'),
  ('create_crew(text, jsonb)'), ('respond_crew(bigint, boolean)'), ('cancel_crew()'), ('start_crew()'), ('get_crews()'),
  ('play_casino(text, bigint, text)'), ('buy_transport(text)'), ('crush_car(bigint)');

create or replace function apply_grants() returns void
language plpgsql as $$
declare s text;
begin
  execute 'revoke execute on all functions in schema public from public, anon, authenticated';
  for s in select sig from api_rpcs loop
    execute format('grant execute on function %s to authenticated', s);
  end loop;
end $$;

-- ─────────────── Küfür filtresi ───────────────
create table banned_words (word text primary key);
alter table banned_words enable row level security;
insert into banned_words values
  ('amk'), ('aq'), ('amına'), ('amina'), ('orospu'), ('oç'), ('piç'), ('siktir'), ('sikerim'), ('sikeyim'),
  ('yarrak'), ('yarak'), ('götveren'), ('ibne'), ('kahpe'), ('pezevenk'), ('ananı'), ('anani'),
  ('fuck'), ('shit'), ('bitch'), ('nigger'), ('faggot');

-- Kelime sınırıyla eşleşen yasaklı kelimeleri *** yapar (ör. "sikke" etkilenmez)
create or replace function clean_text(t text) returns text
language plpgsql stable as $$
declare w text;
begin
  for w in select word from banned_words loop
    t := regexp_replace(t, '\m' || w || '\M', repeat('*', length(w)), 'gi');
  end loop;
  return t;
end $$;

-- Aile sohbetine de filtre uygula
create or replace function family_msg(fid bigint, pid uuid, t text) returns void
language sql as $$ insert into family_messages (family_id, player_id, text) values (fid, pid, clean_text(t)) $$;

-- ─────────────── Engelleme ───────────────
create table blocks (
  blocker_id uuid not null references players(id) on delete cascade,
  blocked_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table blocks enable row level security;

create or replace function is_blocked(a uuid, b uuid) returns boolean  -- a, b'yi engelledi mi
language sql stable as $$ select exists (select 1 from blocks where blocker_id = a and blocked_id = b) $$;

create or replace function block_player(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players;
begin
  t := player_by_nick(p_nick);
  if t.id is null or t.id = auth.uid() then return fail('Geçersiz oyuncu.'); end if;
  insert into blocks values (auth.uid(), t.id) on conflict do nothing;
  return done(t.nick || ' engellendi. Mesajlarını görmeyeceksin.');
end $$;

create or replace function unblock_player(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from blocks where blocker_id = auth.uid() and blocked_id = (player_by_nick(p_nick)).id;
  return done('Engel kaldırıldı.');
end $$;

-- ─────────────── Şikâyet ───────────────
create table reports (
  id          bigserial primary key,
  reporter_id uuid references players(id) on delete set null,
  target_id   uuid references players(id) on delete set null,
  kind        text not null check (kind in ('message', 'family_message', 'chat_message', 'player')),
  ref_id      bigint,
  snapshot    text,           -- şikâyet anındaki içerik (silinse de kanıt kalsın)
  reason      text not null check (length(reason) between 1 and 300),
  status      text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now()
);
alter table reports enable row level security;

create or replace function report_content(p_kind text, p_ref bigint, p_nick text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players; snap text; tid uuid;
begin
  if p_kind = 'message' then
    select m.text, m.from_id into snap, tid from messages m where m.id = p_ref and m.to_id = auth.uid();
  elsif p_kind = 'family_message' then
    select fm.text, fm.player_id into snap, tid from family_messages fm
     where fm.id = p_ref and fm.family_id = (select family_id from players where id = auth.uid());
  elsif p_kind = 'chat_message' then   -- genel/şehir sohbeti (tablo 012'de)
    select cm.text, cm.player_id into snap, tid from chat_messages cm where cm.id = p_ref;
  elsif p_kind = 'player' then
    tid := (player_by_nick(p_nick)).id;
  else
    raise exception 'BAD_KIND';
  end if;
  select * into t from players where id = tid;
  if t.id is null then return fail('Şikâyet edilecek içerik bulunamadı.'); end if;
  if (select count(*) from reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    return fail('Çok fazla şikâyet gönderdin, biraz bekle.');
  end if;
  insert into reports (reporter_id, target_id, kind, ref_id, snapshot, reason)
    values (auth.uid(), t.id, p_kind, p_ref, snap, left(coalesce(nullif(trim(p_reason), ''), 'belirtilmedi'), 300));
  return done('Şikâyetin moderatörlere iletildi. Teşekkürler.');
end $$;

-- ─────────────── Özel mesajlar ───────────────
create table messages (
  id         bigserial primary key,
  from_id    uuid not null references players(id) on delete cascade,
  to_id      uuid not null references players(id) on delete cascade,
  text       text not null check (length(text) between 1 and 500),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on messages (to_id, id desc);
create index on messages (from_id, id desc);
alter table messages enable row level security;

create or replace function send_message(p_nick text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players; txt text := trim(p_text);
begin
  t := player_by_nick(p_nick);
  if t.id is null or t.id = auth.uid() then return fail('Geçersiz alıcı.'); end if;
  if length(txt) = 0 then return fail('Boş mesaj.'); end if;
  if length(txt) > 500 then return fail('Mesaj en fazla 500 karakter.'); end if;
  if (select count(*) from messages where from_id = auth.uid() and created_at > now() - interval '1 minute') >= 6 then
    return fail('Çok hızlı yazıyorsun.');
  end if;
  -- engellendiysen mesaj sessizce düşmez; gönderene söylenir
  if is_blocked(t.id, auth.uid()) then return fail(t.nick || ' senden mesaj almıyor.'); end if;
  insert into messages (from_id, to_id, text) values (auth.uid(), t.id, clean_text(txt));
  return jsonb_build_object('ok', true);
end $$;

create or replace function get_inbox() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'last_id')::bigint desc), '[]') from (
    select jsonb_build_object('nick', o.nick, 'last', c.text, 'at', c.created_at, 'last_id', c.id,
      'unread', (select count(*) from messages u where u.to_id = auth.uid() and u.from_id = o.id and u.read_at is null),
      'blocked', is_blocked(auth.uid(), o.id)) x
    from (select distinct on (other) id, text, created_at, other from (
            select id, text, created_at, case when from_id = auth.uid() then to_id else from_id end other
            from messages where from_id = auth.uid() or to_id = auth.uid()) m
          order by other, id desc) c
    join players o on o.id = c.other
    where not is_blocked(auth.uid(), o.id)
    limit 50
  ) s
$$;

create or replace function get_conversation(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players;
begin
  t := player_by_nick(p_nick);
  if t.id is null then return '[]'; end if;
  update messages set read_at = now() where to_id = auth.uid() and from_id = t.id and read_at is null;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.from_id = auth.uid(), 'text', m.text,
            'at', m.created_at) order by m.id), '[]')
          from (select * from messages where (from_id = auth.uid() and to_id = t.id) or (from_id = t.id and to_id = auth.uid())
                order by id desc limit 50) m);
end $$;

-- ─────────────── Saygı puanı (Omerta: honour points) ───────────────
-- Her hafta rütbeye göre dağıtılacak puan gelir; kendine verilemez, satılamaz.
alter table players
  add column respect        int not null default 0,
  add column respect_left   int not null default 0,
  add column respect_week   date;

create or replace function refresh_respect(p uuid) returns void
language sql as $$
  update players set respect_left = 5 + 2 * rank_of(xp), respect_week = date_trunc('week', now())::date
  where id = p and (respect_week is null or respect_week < date_trunc('week', now())::date)
$$;

create or replace function give_respect(p_nick text, p_points int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players;
begin
  perform refresh_respect(auth.uid());
  p := me_for_update();
  if p_points < 1 then raise exception 'BAD_POINTS'; end if;
  t := player_by_nick(p_nick);
  if t.id is null or t.id = p.id then return fail('Geçersiz oyuncu.'); end if;
  if p.respect_left < p_points then return fail('Bu hafta sadece ' || p.respect_left || ' puanın kaldı.'); end if;
  update players set respect_left = respect_left - p_points where id = p.id;
  update players set respect = respect + p_points where id = t.id;
  perform log_event(t.id, p.nick || ' sana ' || p_points || ' saygı puanı verdi.');
  return done(t.nick || ' kişisine ' || p_points || ' saygı puanı verdin.');
end $$;

-- ─────────────── Sarmalayıcılar ───────────────
-- Profil: saygı, engel durumu
alter function get_profile(text) rename to profile_families;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_families(p_nick) || jsonb_build_object('respect', t.respect, 'blocked', is_blocked(auth.uid(), t.id))
  from players t where lower(t.nick) = lower(p_nick)
$$;

-- Aile sohbeti: engellediklerimin mesajları görünmesin; mesaj id'si şikâyet için gelsin
alter function get_family() rename to family_core;
create or replace function get_family() returns jsonb
language plpgsql security definer set search_path = public as $$
declare base jsonb := family_core(); fid bigint;
begin
  if base->'family' = 'null'::jsonb then return base; end if;
  fid := (base->'family'->>'id')::bigint;
  return jsonb_set(base, '{messages}', (
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nick', mp.nick, 'text', m.text, 'at', m.created_at) order by m.id), '[]')
    from (select * from family_messages where family_id = fid order by id desc limit 50) m
    left join players mp on mp.id = m.player_id
    where m.player_id is null or not is_blocked(auth.uid(), m.player_id)));
end $$;

alter function get_state() rename to state_casino;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb; p players;
begin
  base := state_casino();
  if base->'player' = 'null'::jsonb then return base; end if;
  perform refresh_respect(auth.uid());
  select * into p from players where id = auth.uid();
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object(
    'respect', p.respect, 'respect_left', p.respect_left,
    'unread', (select count(*) from messages where to_id = p.id and read_at is null and not is_blocked(p.id, from_id))));
end $$;

insert into api_rpcs values
  ('block_player(text)'), ('unblock_player(text)'), ('report_content(text, bigint, text, text)'),
  ('send_message(text, text)'), ('get_inbox()'), ('get_conversation(text)'), ('give_respect(text, integer)');
select apply_grants();
