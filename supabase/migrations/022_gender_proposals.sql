-- 022: Cinsiyet ve evlenme teklifi kuralları.
-- • Oyuncu girişte cinsiyetini seçer (sonradan değişmez); portreler cinsiyete göre (1–4 erkek, 5–8 kadın).
-- • Evlilik sadece karşı cinsle. Teklif sadece bekâr ve arkadaş olan birine; aynı anda tek teklif, tekrar gönderilemez.
-- • Reddedilen teklif aynı kişiye ancak 14 gün sonra tekrar gönderilebilir. Teklif geri çekilebilir.

insert into game_settings values ('proposal_retry_days', 14)
on conflict (key) do update set value = excluded.value;

alter table players add column if not exists gender text check (gender in ('e', 'k'));
update players set gender = case when avatar between 5 and 8 then 'k' else 'e' end where gender is null;

create table proposal_rejections (
  from_id uuid not null references players(id) on delete cascade,
  to_id   uuid not null references players(id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (from_id, to_id)
);
alter table proposal_rejections enable row level security;

create or replace function avatar_fits(p_gender text, p_avatar int) returns boolean
language sql immutable as $$ select case when p_gender = 'k' then p_avatar between 5 and 8 else p_avatar between 1 and 4 end $$;

-- Girişte tek adımda: ad + cinsiyet + portre
create or replace function create_character(p_nick text, p_gender text, p_avatar int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if p_gender not in ('e', 'k') then return fail('Cinsiyetini seç.'); end if;
  if not avatar_fits(p_gender, p_avatar) then return fail('Bu portre seçtiğin cinsiyete uygun değil.'); end if;
  r := create_player(p_nick);
  if (r->>'ok')::boolean then
    update players set gender = p_gender, avatar = p_avatar where id = auth.uid();
  end if;
  return r;
end $$;

-- Portre değiştirirken cinsiyete uygun olanlar
alter function set_avatar(int) rename to set_avatar_core;
create or replace function set_avatar(p_avatar int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g text := (select gender from players where id = auth.uid());
begin
  if g is not null and not avatar_fits(g, p_avatar) then return fail('Bu portre cinsiyetine uygun değil.'); end if;
  return set_avatar_core(p_avatar);
end $$;

create or replace function propose(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; rej timestamptz; pending players;
begin
  p := me_for_update();
  if p.spouse_id is not null then return fail('Zaten evlisin.'); end if;
  t := player_by_nick(p_nick);
  if t.id is null or t.id = p.id then return fail('Geçersiz kişi.'); end if;
  if t.spouse_id is not null then return fail(t.nick || ' zaten evli.'); end if;
  if p.gender is null or t.gender is null or p.gender = t.gender then return fail('Evlilik sadece karşı cinsten biriyle olur.'); end if;
  if not are_friends(p.id, t.id) then return fail('Evlenme teklifi sadece arkadaşlarına gönderilebilir.'); end if;
  if is_blocked(t.id, p.id) then return fail(t.nick || ' teklifine kapalı.'); end if;
  if p.proposal_to = t.id then return fail('Teklifin zaten ' || t.nick || ' kişisinde, cevap bekleniyor.'); end if;
  if p.proposal_to is not null then
    select * into pending from players where id = p.proposal_to;
    if pending.id is not null and pending.spouse_id is null then
      return fail('Bekleyen bir teklifin var (' || pending.nick || '). Önce onu geri çek.');
    end if;
  end if;
  select at into rej from proposal_rejections where from_id = p.id and to_id = t.id;
  if rej > now() - make_interval(days => setting('proposal_retry_days')::int) then
    return fail(t.nick || ' teklifini reddetti. Tekrar teklif için '
      || ceil(extract(epoch from rej + make_interval(days => setting('proposal_retry_days')::int) - now()) / 86400)::int || ' gün beklemelisin.');
  end if;
  update players set proposal_to = t.id where id = p.id;
  perform log_event(t.id, p.nick || ' sana evlenme teklif etti! Profilinden kabul ya da reddedebilirsin.');
  return done('Teklif iletildi. Kabul ederse düğün masrafı ($' || setting('marriage_cost') || ') senden çıkar.');
end $$;

create or replace function reject_proposal(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players;
begin
  select * into t from players where lower(nick) = lower(p_nick) and proposal_to = auth.uid() for update;
  if not found then return fail('Bu kişiden teklif yok.'); end if;
  update players set proposal_to = null where id = t.id;
  insert into proposal_rejections values (t.id, auth.uid(), now())
    on conflict (from_id, to_id) do update set at = excluded.at;
  perform log_event(t.id, (select nick from players where id = auth.uid()) || ' evlenme teklifini reddetti.');
  return done('Teklif reddedildi.');
end $$;

create or replace function cancel_proposal() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update players set proposal_to = null where id = auth.uid() and proposal_to is not null;
  if not found then return fail('Bekleyen teklifin yok.'); end if;
  return done('Teklifini geri çektin.');
end $$;

-- Profil ve durum: cinsiyet, benim teklifim
alter function get_profile(text) rename to profile_community;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_community(p_nick) || jsonb_build_object(
    'gender', (select gender from players where lower(nick) = lower(p_nick)),
    'i_proposed', (select proposal_to from players where id = auth.uid()) = (select id from players where lower(nick) = lower(p_nick)))
$$;

alter function get_state() rename to state_men;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb := state_men();
begin
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object(
    'gender', (select gender from players where id = auth.uid()),
    'proposal_to', (select t.nick from players p join players t on t.id = p.proposal_to where p.id = auth.uid())));
end $$;

insert into api_rpcs values ('create_character(text, text, integer)'), ('reject_proposal(text)'), ('cancel_proposal()');
select apply_grants();
