-- 036: Oyuncu önerileri turu (2026-11). Tekrar çalıştırılabilir.
--  A) Hapisteki oyuncu vurulamaz · hastaneden çıkınca 30 dk dokunulmazlık · aynı katil aynı kişiyi 12 saat tekrar vuramaz
--  B) Banka faizi: günde %1, günlük en fazla 50.000; birikmiş en fazla 7 gün
--  C) Kurşun fabrikaları baskınla el değiştirir: her şehirde fabrika bir "mekân" satırıyla eşlenir (baskın, tahkim, nöbet aynı kodla)
--  D) Sarhoş / serseri baskınları: sahipli mekân ve fabrikalara birkaç saatte bir yerel çete saldırır
--  E) Öneri cevapları oyuncuya önerisi ve yönetimin notuyla birlikte gider; her durum değişiminde

insert into game_settings values
  ('post_hospital_grace_s',  1800),
  ('same_kill_block_s',     43200),
  ('bank_interest',          0.01),
  ('bank_interest_cap',     50000),
  ('bank_interest_max_days',    7),
  ('npc_raid_min_h',            4),
  ('npc_raid_max_h',            8),
  ('npc_raid_min',              3),
  ('npc_raid_max',              8),
  ('npc_raid_wear',           0.5),
  ('npc_factory_income',     4000),
  ('npc_first_grace_h',        24)   -- güncelleme gelince mevcut sahiplere tahkim için süre
on conflict (key) do nothing;

-- ═══════════════ A) Atış korumaları ═══════════════
create table if not exists kill_log (
  id        bigserial primary key,
  killer_id uuid not null references players(id) on delete cascade,
  victim_id uuid not null references players(id) on delete cascade,
  at        timestamptz not null default now()
);
create index if not exists kill_log_pair on kill_log (killer_id, victim_id, at desc);
alter table kill_log enable row level security;

-- Hedefe şu an ateş edilemiyorsa sebebini döner (hastanedeki hedefi çekirdek kod zaten ele alıyor)
create or replace function shoot_block(p_me uuid, t players) returns text
language plpgsql stable as $$
declare last_kill timestamptz;
begin
  if t.jail_until > now() then
    return t.nick || ' hapiste; içerideki birine kurşun işlemez.';
  end if;
  if t.deaths > 0 and t.hospital_until <= now()
     and t.hospital_until > now() - make_interval(secs => setting('post_hospital_grace_s')) then
    return t.nick || ' hastaneden yeni çıktı; ' || fmt_wait(t.hospital_until + make_interval(secs => setting('post_hospital_grace_s')))
      || ' daha dokunulmaz.';
  end if;
  select max(at) into last_kill from kill_log where killer_id = p_me and victim_id = t.id;
  if t.hospital_until <= now() and last_kill > now() - make_interval(secs => setting('same_kill_block_s')) then
    return t.nick || ' kişisini kısa süre önce sen öldürdün; ' || fmt_wait(last_kill + make_interval(secs => setting('same_kill_block_s')))
      || ' geçmeden ona yeniden silah çekemezsin.';
  end if;
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'shoot_men') then alter function shoot(text, int) rename to shoot_men; end if;
  if not exists (select 1 from pg_proc where proname = 'shoot_preview_rich') then alter function shoot_preview(text) rename to shoot_preview_rich; end if;
end $$;

create or replace function shoot(p_nick text, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players := player_by_nick(p_nick); b text; r jsonb;
begin
  if t.id is not null then
    b := shoot_block(auth.uid(), t);
    if b is not null then return fail(b); end if;   -- bekleme süresi ve kurşun harcanmaz
  end if;
  r := shoot_men(p_nick, p_bullets);
  if t.id is not null and coalesce((r->>'killed')::boolean, false) then
    insert into kill_log (killer_id, victim_id) values (auth.uid(), t.id);
  end if;
  return r;
end $$;

create or replace function shoot_preview(p_nick text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t players := player_by_nick(p_nick); b text;
begin
  if t.id is not null then
    b := shoot_block(auth.uid(), t);
    if b is not null then return fail(b); end if;
  end if;
  return shoot_preview_rich(p_nick);
end $$;

-- ═══════════════ B) Banka faizi ═══════════════
alter table players add column if not exists interest_at timestamptz;

-- Tam günler için faizi hesaba ekler (bileşik, günlük tavanlı, en fazla 7 gün). Faizin başladığı an ilk çağrıdır;
-- bakiye 0 iken de saat ilerler, böylece "yatırıp hemen faiz almak" olmaz.
create or replace function accrue_interest(pid uuid) returns bigint
language plpgsql as $$
declare p players; days int; b bigint; gain bigint; total bigint := 0;
begin
  select * into p from players where id = pid for update;
  if p.id is null then return 0; end if;
  if p.interest_at is null then
    update players set interest_at = now() where id = pid;
    return 0;
  end if;
  days := floor(extract(epoch from now() - p.interest_at) / 86400);
  if days < 1 then return 0; end if;
  b := p.bank;
  for i in 1 .. least(days, setting('bank_interest_max_days')::int) loop
    gain := least(floor(b * setting('bank_interest')), setting('bank_interest_cap'))::bigint;
    b := b + gain; total := total + gain;
  end loop;
  update players set bank = b, interest_at = interest_at + make_interval(days => days) where id = pid;
  if total > 0 then perform log_event(pid, 'Banka faizi: $' || total || ' hesabına eklendi.'); end if;
  return total;
end $$;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'bank_move_core') then alter function bank_move(bigint) rename to bank_move_core; end if;
end $$;
create or replace function bank_move(p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform accrue_interest(auth.uid());   -- yatırma/çekmeden önce birikmiş faiz
  return bank_move_core(p_amount);
end $$;

-- ═══════════════ C) Fabrika = mekân ═══════════════
alter table spots drop constraint if exists spots_kind_check;
alter table spots add constraint spots_kind_check check (kind in ('gazino', 'meyhane', 'kahvehane', 'antrepo', 'fabrika'));
alter table spots add column if not exists npc_at timestamptz;   -- sıradaki serseri baskını

insert into spots (city_id, name, kind, income, owner_family)
select c.id, c.name || ' Kurşun Fabrikası', 'fabrika', 0, cb.owner_family
  from cities c join city_bullets cb on cb.city_id = c.id
 where not exists (select 1 from spots s where s.city_id = c.id and s.kind = 'fabrika');

-- Sahip değişince: sahipsiz kalan mekânın barikatı dağılır; yeni sahibe ilk serseri baskını birkaç saat sonra
create or replace function spot_owner_change() returns trigger
language plpgsql as $$
begin
  if new.owner_family is distinct from old.owner_family then
    if new.owner_family is null then
      new.defense := 0; new.npc_at := null;
    else
      new.npc_at := now() + make_interval(secs => 3600 * (setting('npc_raid_min_h')
                      + random() * (setting('npc_raid_max_h') - setting('npc_raid_min_h'))));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists spot_owner_change on spots;
create trigger spot_owner_change before update of owner_family on spots for each row execute function spot_owner_change();

-- İki yönlü eşleme: fabrika mekânının sahibi ↔ city_bullets.owner_family (satın alma, baskın, aile dağılması, sezon)
create or replace function sync_factory_from_spot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'fabrika' and new.owner_family is distinct from old.owner_family then
    update city_bullets set owner_family = new.owner_family
     where city_id = new.city_id and owner_family is distinct from new.owner_family;
  end if;
  return new;
end $$;
drop trigger if exists sync_factory_from_spot on spots;
create trigger sync_factory_from_spot after update of owner_family on spots for each row execute function sync_factory_from_spot();

create or replace function sync_spot_from_factory() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_family is distinct from old.owner_family then
    update spots set owner_family = new.owner_family
     where kind = 'fabrika' and city_id = new.city_id and owner_family is distinct from new.owner_family;
  end if;
  return new;
end $$;
drop trigger if exists sync_spot_from_factory on city_bullets;
create trigger sync_spot_from_factory after update of owner_family on city_bullets for each row execute function sync_spot_from_factory();

-- Sahipsiz fabrika baskınla değil satın alınarak alınır
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'raid_spot_night') then alter function raid_spot(int, int) rename to raid_spot_night; end if;
  if not exists (select 1 from pg_proc where proname = 'raid_preview_core') then alter function raid_preview(int, int) rename to raid_preview_core; end if;
end $$;
create or replace function factory_raid_block(p_spot int) returns text
language sql stable as $$
  select 'Sahipsiz fabrika baskınla alınmaz; ailenin Don ya da Sottocapo''su Aile sekmesinden satın alabilir.'
  from spots where id = p_spot and kind = 'fabrika' and owner_family is null
$$;
create or replace function raid_spot(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := factory_raid_block(p_spot);
begin
  if b is not null then return fail(b); end if;
  return raid_spot_night(p_spot, p_bullets);
end $$;
create or replace function raid_preview(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := factory_raid_block(p_spot);
begin
  if b is not null then return fail(b); end if;
  return raid_preview_core(p_spot, p_bullets);
end $$;

-- Aile listesindeki mekân sayısı fabrikayı ayrıca saymasın (fabrikalar kendi sütununda)
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'families_men') then alter function get_families() rename to families_men; end if;
end $$;
create or replace function get_families() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(f || jsonb_build_object('spots',
    (select count(*) from spots s join families fa on fa.id = s.owner_family where fa.name = f->>'name' and s.kind <> 'fabrika'))), '[]')
  from jsonb_array_elements(families_men()) f
$$;

-- ═══════════════ D) Serseri baskınları ═══════════════
-- Savunma canı = barikat (kurşun / battle_wall_hp_div) + nöbetteki adamların canı.
-- Serseri gücü = (saatlik gelir/1000 + 1) × rastgele(npc_raid_min..max). Fabrikanın geliri npc_factory_income sayılır.
--  · Savunma yeterse püskürtülür, barikat biraz aşınır.
--  · Savunma var ama yetmezse: barikat yıkılır, mekânda bir saatlik haraç (fabrikada stoğun yarısı) yağmalanır.
--  · Hiç savunma yoksa mekân elden çıkar.
create or replace function npc_raids() returns void
language plpgsql as $$
declare s spots; hp numeric; atk numeric; wear int; loot bigint; msg text; nxt timestamptz; fam bigint;
begin
  for s in select * from spots where owner_family is not null and npc_at is not null and npc_at <= now()
           order by npc_at for update skip locked loop
    fam := s.owner_family;
    hp := s.defense / setting('battle_wall_hp_div') + coalesce((
      select sum(t.defense) from player_men m join man_types t on t.id = m.type_id join players pl on pl.id = m.player_id
       where m.spot_id = s.id and m.ready_at <= now() and pl.family_id = s.owner_family), 0);
    atk := round((greatest(s.income, case when s.kind = 'fabrika' then setting('npc_factory_income') else 0 end) / 1000.0 + 1)
                  * (setting('npc_raid_min') + random() * (setting('npc_raid_max') - setting('npc_raid_min'))));
    nxt := now() + make_interval(secs => 3600 * (setting('npc_raid_min_h') + random() * (setting('npc_raid_max_h') - setting('npc_raid_min_h'))));

    if hp >= atk then
      wear := least(s.defense, floor(atk * setting('battle_wall_hp_div') * setting('npc_raid_wear')))::int;
      update spots set defense = defense - wear, npc_at = nxt where id = s.id;
      msg := 'Sarhoş bir serseri çetesi ' || s.name || ' önünde olay çıkardı; nöbetçiler püskürttü.'
        || case when wear > 0 then ' Barikattan ' || wear || ' kurşun gitti.' else '' end;
    elsif hp > 0 then
      if s.kind = 'fabrika' then
        update city_bullets set stock = stock / 2 where city_id = s.city_id;
        msg := 'Serseriler ' || s.name || ' barikatını aşıp depodaki kurşunların yarısını yağmaladı. Barikat yıkıldı.';
      else
        select least(bank, s.income) into loot from families where id = fam;
        update families set bank = bank - loot where id = fam;
        msg := 'Serseriler ' || s.name || ' barikatını aşıp kasadan $' || loot || ' haraç yağmaladı. Barikat yıkıldı.';
      end if;
      update spots set defense = 0, npc_at = nxt where id = s.id;
    else
      update spots set owner_family = null where id = s.id;   -- tetikleyiciler: barikat sıfır, fabrikada sahiplik de düşer
      msg := s.name || ' korumasız kaldı; serseriler bastı ve elimizden çıktı. Mekânları boş bırakmayın: tahkim edin ya da nöbetçi bırakın.';
    end if;
    perform family_msg(fam, null, msg);
  end loop;
end $$;

-- Mekân geliri her toplandığında serseri baskınları da işlenir (cron gerekmez)
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'collect_spots_core') then alter function collect_spots() rename to collect_spots_core; end if;
end $$;
create or replace function collect_spots() returns void
language plpgsql as $$
begin
  perform collect_spots_core();
  perform npc_raids();
end $$;

-- Güncelleme gelince mevcut sahiplere tahkim için süre tanı (sadece ilk kez)
update spots set npc_at = now() + make_interval(hours => setting('npc_first_grace_h')::int)
 where owner_family is not null and npc_at is null;

-- ═══════════════ E) Öneri cevapları ═══════════════
alter table suggestions add column if not exists notified text;   -- oyuncuya en son bildirilen durum + not

create or replace function admin_suggestion_set(p_id bigint, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s suggestions; note text := nullif(trim(p_note), ''); snippet text; sig text;
begin
  perform require_owner();
  if p_status not in ('yeni', 'okundu', 'planlandi', 'yapildi', 'reddedildi') then raise exception 'BAD_STATUS'; end if;
  update suggestions set status = p_status, admin_note = note, updated_at = now() where id = p_id returning * into s;
  if s.id is null then return fail('Öneri yok.'); end if;
  -- Aynı durum + aynı not ikinci kez bildirilmez
  sig := p_status || '|' || coalesce(note, '');
  if p_status <> 'yeni' and s.notified is distinct from sig then
    snippet := case when length(s.text) > 60 then left(s.text, 57) || '…' else s.text end;
    perform log_event(s.player_id, '💡 Önerin (“' || snippet || '”) '
      || case p_status when 'okundu' then 'yönetim tarafından okundu.' when 'planlandi' then 'plana alındı.'
                       when 'yapildi' then 'oyuna eklendi!' else 'şimdilik yapılmayacak.' end
      || coalesce(' Yönetimin notu: ' || note, ''));
    update suggestions set notified = sig where id = s.id;
  end if;
  return done('Öneri güncellendi; oyuncuya bildirildi.');
end $$;

-- ═══════════════ Durum ═══════════════
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'state_chat_style') then alter function get_state() rename to state_chat_style; end if;
end $$;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb;
begin
  if exists (select 1 from players where id = auth.uid()) then perform accrue_interest(auth.uid()); end if;
  perform npc_raids();
  base := state_chat_style();
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  return jsonb_set(base, '{player}', (base->'player') || (select jsonb_build_object('interest_at', interest_at)
    from players where id = auth.uid()));
end $$;

select apply_grants();
