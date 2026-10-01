-- Faz 2A: kurşun, silah, dedektif, vurma/öldürme, koruma, hastane, hapisten kurtarma,
-- banka, para transferi, profil, sıralama, çevrimiçi liste.
-- Ölüm kalıcı değil: öldürülen oyuncu cebindeki paranın %25'ini ve kurşunlarının yarısını kaybeder,
-- 45 dk hastanede kalır. Bankadaki para güvende (ama yatırırken %5 komisyon var).

insert into game_settings values
  ('kill_cooldown_s',     1200),
  ('bust_cooldown_s',       20),
  ('practice_cooldown_s',  180),
  ('bust_fail_jail_s',      60),
  ('hospital_s',          2700),
  ('protect_rank',           3),   -- bu rütbenin altındakiler vuramaz/vurulamaz
  ('detective_cost',       250),
  ('bullet_restock_s',     300),
  ('bullet_restock_qty',   300),
  ('bullet_stock_cap',    3000),
  ('bank_fee',          0.05),
  ('transfer_fee',      0.05),
  ('heal_cost_per_hp',      40),
  ('kill_cash_loss',     0.25),
  ('kill_bullet_loss',   0.50),
  ('kill_loot_share',    0.10),   -- öldüren, hedefin cebindeki paranın bu kadarını alır (kaybın bir parçası; kalanı yok olur)
  ('kill_loot_cap_rank', 20000),  -- tek seferde en fazla: hedefin rütbesi × bu tutar
  ('kill_loot_cooldown_h', 24);   -- aynı hedeften bu süre içinde ikinci kez para alınmaz (ikinci hesapla para taşımayı zorlaştırır)

-- Kimin kimden ne zaman para aldığı (aynı hedefi tekrar tekrar soymayı engeller)
create table kill_loot (
  killer_id uuid not null references players(id) on delete cascade,
  victim_id uuid not null references players(id) on delete cascade,
  amount    bigint not null,
  at        timestamptz not null default now()
);
create index on kill_loot (killer_id, victim_id, at desc);

-- Rütbe başına "bu rütbeyi tek seferde öldürmek için gereken" temel kurşun
alter table ranks add column kill_bullets int not null default 0;
update ranks set kill_bullets = v from (values (3,120),(4,200),(5,320),(6,500),(7,750),(8,1100),(9,1600)) x(r, v)
 where id = r;

create table weapons (
  id          text primary key,
  name        text not null,
  price       int  not null,
  bullet_mult numeric not null,   -- gereken kurşun çarpanı (küçük = daha iyi)
  min_rank    int  not null
);
insert into weapons values
  ('tabanca',  'Tabanca',        2500, 1.00, 2),
  ('pompali',  'Pompalı Tüfek', 12000, 0.85, 4),
  ('thompson', 'Thompson',      40000, 0.70, 6);

create table bodyguard_prices (n int primary key, price int not null);
insert into bodyguard_prices values (1, 5000), (2, 15000), (3, 40000), (4, 100000), (5, 250000);

alter table players
  add column health            int     not null default 100 check (health between 0 and 100),
  add column bullets           int     not null default 0 check (bullets >= 0),
  add column bank              bigint  not null default 0 check (bank >= 0),
  add column weapon_id         text    references weapons(id),
  add column bodyguards        int     not null default 0,
  add column kill_skill        numeric not null default 0,
  add column kill_ready_at     timestamptz not null default now(),
  add column bust_ready_at     timestamptz not null default now(),
  add column practice_ready_at timestamptz not null default now(),
  add column self_bust_left    int     not null default 3,
  add column self_bust_for     timestamptz,           -- hangi hapis cezası için sayılıyor
  add column bullets_hour_start timestamptz not null default now(),
  add column bullets_hour_bought int   not null default 0,
  add column kills             int     not null default 0,
  add column deaths            int     not null default 0,
  add column busts             int     not null default 0,
  add column last_seen         timestamptz not null default now();

-- Her şehrin kurşun fabrikası: stok 5 dakikada bir dolar, fiyat her dolumda değişir.
create table city_bullets (
  city_id      text primary key references cities(id),
  stock        int  not null,
  price        int  not null,
  restocked_at timestamptz not null default now()
);
insert into city_bullets select id, 1500, 6, now() from cities;

create table detective_searches (
  id         bigserial primary key,
  player_id  uuid not null references players(id) on delete cascade,
  target_id  uuid not null references players(id) on delete cascade,
  success    boolean not null,        -- hiring anında belirlenir
  city_found text references cities(id),
  ready_at   timestamptz not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index on detective_searches (player_id, id desc);

alter table weapons          enable row level security;
alter table bodyguard_prices enable row level security;
alter table city_bullets     enable row level security;
alter table detective_searches enable row level security;

-- ─────────────── Yardımcılar ───────────────
create or replace function player_by_nick(p_nick text) returns players
language sql stable as $$ select * from players where lower(nick) = lower(p_nick) $$;

create or replace function required_bullets(t players, s players) returns int
language sql stable as $$
  select ceil(
    (select kill_bullets from ranks where id = rank_of(t.xp))
    * (1 + 0.2 * t.bodyguards)
    * coalesce((select bullet_mult from weapons where id = s.weapon_id), 1)
    * (1 - least(s.kill_skill, 100) / 250.0)
    * t.health / 100.0
  )::int
$$;

-- Fabrikayı tembel şekilde doldurur (cron gerekmez)
create or replace function restock_bullets(p_city text) returns city_bullets
language plpgsql as $$
declare f city_bullets; periods int; step numeric := setting('bullet_restock_s');
begin
  select * into f from city_bullets where city_id = p_city for update;
  periods := floor(extract(epoch from now() - f.restocked_at) / step);
  if periods > 0 then
    update city_bullets set
      stock = least(setting('bullet_stock_cap'), stock + periods * setting('bullet_restock_qty')),
      price = 4 + floor(random() * 7)::int,
      restocked_at = restocked_at + make_interval(secs => periods * step)
    where city_id = p_city returning * into f;
  end if;
  return f;
end $$;

-- Dedektif aramaları süresi dolunca sonuçlanır: hedefin O ANKİ şehri kaydedilir.
create or replace function resolve_searches(p uuid) returns void
language sql as $$
  update detective_searches d set resolved = true,
    city_found = case when d.success then (select city_id from players where id = d.target_id) end
  where d.player_id = p and not d.resolved and d.ready_at <= now()
$$;

create or replace function hourly_bullet_limit(p players) returns int
language sql stable as $$ select 200 + 50 * rank_of(p.xp) $$;

-- ─────────────── Durum ───────────────
-- 001'deki get_state çekirdek oldu; yeni get_state onu genişletiyor.
alter function get_state() rename to state_core;

create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb; p players; f city_bullets;
begin
  base := state_core();
  if base->'player' = 'null'::jsonb then return base; end if;
  update players set last_seen = now() where id = auth.uid() returning * into p;
  perform resolve_searches(p.id);
  f := restock_bullets(p.city_id);
  return base
    || jsonb_build_object('player', (base->'player') || jsonb_build_object(
         'health', p.health, 'bullets', p.bullets, 'bank', p.bank, 'weapon', p.weapon_id,
         'bodyguards', p.bodyguards, 'kill_skill', round(p.kill_skill, 1),
         'kills', p.kills, 'deaths', p.deaths, 'busts', p.busts,
         'kill_ready_at', p.kill_ready_at, 'bust_ready_at', p.bust_ready_at,
         'practice_ready_at', p.practice_ready_at,
         'self_bust_left', case when p.self_bust_for = p.jail_until then p.self_bust_left else 3 end,
         'bullets_left_hour', hourly_bullet_limit(p) -
            case when p.bullets_hour_start > now() - interval '1 hour' then p.bullets_hour_bought else 0 end))
    || jsonb_build_object(
      'settings', (select jsonb_object_agg(key, value) from game_settings),
      'factory', jsonb_build_object('stock', f.stock, 'price', f.price),
      'weapons', (select jsonb_agg(to_jsonb(w) order by w.price) from weapons w),
      'bodyguard_next', (select price from bodyguard_prices where n = p.bodyguards + 1),
      'searches', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'target', t.nick, 'ready_at', d.ready_at, 'resolved', d.resolved,
          'success', case when d.resolved then d.success end,
          'city', d.city_found) order by d.id desc), '[]')
        from (select * from detective_searches where player_id = p.id
              and created_at > now() - interval '3 hours' order by id desc limit 10) d
        join players t on t.id = d.target_id));
end $$;

-- ─────────────── Kurşun & silah & koruma ───────────────
create or replace function buy_bullets(p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; f city_bullets; bought int; cost bigint;
begin
  p := me_for_update();
  if p_qty <= 0 or p_qty > 5000 then raise exception 'BAD_QTY'; end if;
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  f := restock_bullets(p.city_id);
  bought := case when p.bullets_hour_start > now() - interval '1 hour' then p.bullets_hour_bought else 0 end;
  if bought + p_qty > hourly_bullet_limit(p) then
    return jsonb_build_object('ok', false, 'msg', 'Bu saat en fazla ' || (hourly_bullet_limit(p) - bought) || ' kurşun daha alabilirsin.');
  end if;
  if f.stock < p_qty then return jsonb_build_object('ok', false, 'msg', 'Fabrikada sadece ' || f.stock || ' kurşun var.'); end if;
  cost := p_qty::bigint * f.price;
  if p.cash < cost then return jsonb_build_object('ok', false, 'msg', 'Paran yetmiyor ($' || cost || ').'); end if;

  update city_bullets set stock = stock - p_qty where city_id = p.city_id;
  update players set cash = cash - cost, bullets = bullets + p_qty,
    bullets_hour_start = case when bought = 0 then now() else bullets_hour_start end,
    bullets_hour_bought = bought + p_qty
  where id = p.id;
  return jsonb_build_object('ok', true, 'msg', p_qty || ' kurşun alındı ($' || cost || ').');
end $$;

create or replace function buy_weapon(p_weapon text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; w weapons;
begin
  p := me_for_update();
  select * into w from weapons where id = p_weapon;
  if not found then raise exception 'BAD_WEAPON'; end if;
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if rank_of(p.xp) < w.min_rank then return jsonb_build_object('ok', false, 'msg', 'Bu silah için rütben yetmiyor.'); end if;
  if p.weapon_id = w.id then return jsonb_build_object('ok', false, 'msg', 'Zaten bu silahın var.'); end if;
  if p.cash < w.price then return jsonb_build_object('ok', false, 'msg', 'Paran yetmiyor.'); end if;
  update players set cash = cash - w.price, weapon_id = w.id where id = p.id;
  perform log_event(p.id, w.name || ' satın aldın.');
  return jsonb_build_object('ok', true, 'msg', w.name || ' artık belinde.');
end $$;

create or replace function hire_bodyguard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; price int;
begin
  p := me_for_update();
  select bp.price into price from bodyguard_prices bp where n = p.bodyguards + 1;
  if not found then return jsonb_build_object('ok', false, 'msg', 'En fazla 5 koruma tutabilirsin.'); end if;
  if p.cash < price then return jsonb_build_object('ok', false, 'msg', 'Paran yetmiyor ($' || price || ').'); end if;
  update players set cash = cash - price, bodyguards = bodyguards + 1 where id = p.id;
  return jsonb_build_object('ok', true, 'msg', 'Yeni bir koruma tuttun. Toplam: ' || p.bodyguards + 1);
end $$;

-- Şişe atışı: kurşun yakıp nişancılık kazan
create or replace function practice() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; gain numeric;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if p.weapon_id is null then return jsonb_build_object('ok', false, 'msg', 'Önce bir silah almalısın.'); end if;
  if p.practice_ready_at > now() then
    return jsonb_build_object('ok', false, 'msg', 'Kolun yoruldu. ' || fmt_wait(p.practice_ready_at) || ' bekle.');
  end if;
  if p.bullets < 10 then return jsonb_build_object('ok', false, 'msg', 'Atış için 10 kurşun lazım.'); end if;
  if p.kill_skill >= 100 then return jsonb_build_object('ok', false, 'msg', 'Nişancılığın zirvede.'); end if;
  gain := case when random() < 0.6 then round((0.5 + random())::numeric, 1) else 0 end;
  update players set bullets = bullets - 10, kill_skill = least(100, kill_skill + gain),
    practice_ready_at = now() + make_interval(secs => setting('practice_cooldown_s')) where id = p.id;
  return jsonb_build_object('ok', true, 'success', gain > 0, 'msg',
    case when gain > 0 then 'Şişeleri tek tek indirdin. Nişancılık +' || gain
         else 'Hepsini ıskaladın. 10 kurşun boşa gitti.' end);
end $$;

-- ─────────────── Hastane ───────────────
create or replace function heal() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; missing int; cost int;
begin
  p := me_for_update();
  if p.jail_until > now() then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  missing := 100 - p.health;
  if missing = 0 then return jsonb_build_object('ok', false, 'msg', 'Sağlığın zaten tam.'); end if;
  cost := missing * setting('heal_cost_per_hp');
  if p.cash < cost then return jsonb_build_object('ok', false, 'msg', 'Doktor $' || cost || ' istiyor.'); end if;
  update players set cash = cash - cost, health = 100 where id = p.id;
  return jsonb_build_object('ok', true, 'msg', 'Yaraların sarıldı ($' || cost || ').');
end $$;

-- ─────────────── Dedektif & vurma ───────────────
create or replace function hire_detectives(p_nick text, p_count int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; cost int; mins int;
begin
  p := me_for_update();
  if p_count < 1 or p_count > 10 then raise exception 'BAD_COUNT'; end if;
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if rank_of(p.xp) < setting('protect_rank') then
    return jsonb_build_object('ok', false, 'msg', (select name from ranks where id = setting('protect_rank')) || ' rütbesinden önce kimseyi aratamazsın.');
  end if;
  t := player_by_nick(p_nick);
  if t.id is null then return jsonb_build_object('ok', false, 'msg', 'Böyle biri yok.'); end if;
  if t.id = p.id then return jsonb_build_object('ok', false, 'msg', 'Kendini aratamazsın.'); end if;
  if (select count(*) from detective_searches where player_id = p.id and not resolved) >= 3 then
    return jsonb_build_object('ok', false, 'msg', 'Aynı anda en fazla 3 arama yürütebilirsin.');
  end if;
  cost := p_count * setting('detective_cost');
  if p.cash < cost then return jsonb_build_object('ok', false, 'msg', 'Paran yetmiyor ($' || cost || ').'); end if;
  mins := 32 - 2 * p_count;  -- 1 dedektif: 30 dk, 10 dedektif: 12 dk
  update players set cash = cash - cost where id = p.id;
  insert into detective_searches (player_id, target_id, success, ready_at)
    values (p.id, t.id, random() < p_count / 10.0, now() + make_interval(mins => mins));
  return jsonb_build_object('ok', true, 'msg', p_count || ' dedektif ' || t.nick || ' için sokaklara döküldü. ~' || mins || ' dk.');
end $$;

create or replace function shoot(p_nick text, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; need int; dmg int; lost_cash bigint; lost_bullets int; loot bigint := 0; msg text;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if p_bullets < 1 then return jsonb_build_object('ok', false, 'msg', 'Kaç kurşun sıkacağını yaz.'); end if;
  if rank_of(p.xp) < setting('protect_rank') then return jsonb_build_object('ok', false, 'msg', 'Henüz tetik çekecek rütbede değilsin.'); end if;
  if p.weapon_id is null then return jsonb_build_object('ok', false, 'msg', 'Silahın yok.'); end if;
  if p.bullets < p_bullets then return jsonb_build_object('ok', false, 'msg', 'O kadar kurşunun yok.'); end if;
  if p.kill_ready_at > now() then
    return jsonb_build_object('ok', false, 'msg', 'Ortalık çok sıcak. ' || fmt_wait(p.kill_ready_at) || ' bekle.');
  end if;

  select * into t from players where lower(nick) = lower(p_nick) for update;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Böyle biri yok.'); end if;
  if t.id = p.id then return jsonb_build_object('ok', false, 'msg', 'Kendine sıkamazsın.'); end if;
  if rank_of(t.xp) < setting('protect_rank') then
    return jsonb_build_object('ok', false, 'msg', t.nick || ' daha çaylak; ona dokunmak namussuzluk.');
  end if;
  -- Dedektiflerin son 1 saatte bulduğu ve şu an bulunduğun şehirde olmalı
  if not exists (select 1 from detective_searches where player_id = p.id and target_id = t.id
                 and resolved and success and city_found = p.city_id and ready_at > now() - interval '1 hour') then
    return jsonb_build_object('ok', false, 'msg', 'Dedektiflerin hedefi bu şehirde bulmadı: ' || t.nick);
  end if;

  update players set kill_ready_at = now() + make_interval(secs => setting('kill_cooldown_s')) where id = p.id;

  if t.city_id <> p.city_id then
    return jsonb_build_object('ok', true, 'success', false, 'msg', t.nick || ' şehirden çoktan ayrılmış. İz soğudu.');
  end if;
  if t.hospital_until > now() then
    return jsonb_build_object('ok', true, 'success', false, 'msg', t.nick || ' hastanede, içeri giremezsin.');
  end if;

  need := greatest(1, required_bullets(t, p));
  update players set bullets = bullets - p_bullets where id = p.id;

  if p_bullets >= need then
    lost_cash := floor(t.cash * setting('kill_cash_loss'));
    lost_bullets := floor(t.bullets * setting('kill_bullet_loss'));
    update players set cash = cash - lost_cash, bullets = bullets - lost_bullets, health = 100, deaths = deaths + 1,
      hospital_until = now() + make_interval(secs => setting('hospital_s')) where id = t.id;
    -- Kaybın bir kısmı öldürene geçer (sınırlı); aynı hedeften 24 saatte bir kez
    if not exists (select 1 from kill_loot where killer_id = p.id and victim_id = t.id
                   and at > now() - make_interval(hours => setting('kill_loot_cooldown_h')::int)) then
      loot := least(floor(t.cash * setting('kill_loot_share')), rank_of(t.xp) * setting('kill_loot_cap_rank'));
      if loot > 0 then insert into kill_loot (killer_id, victim_id, amount) values (p.id, t.id, loot); end if;
    end if;
    update players set kills = kills + 1, xp = xp + 50 + 10 * rank_of(t.xp), cash = cash + loot where id = p.id;
    msg := t.nick || ' yere serildi! (' || p_bullets || ' kurşun)'
      || case when loot > 0 then ' Cebinden $' || loot || ' aldın.' else '' end;
    perform log_event(p.id, msg);
    perform log_event(t.id, p.nick || ' seni ' || p_bullets || ' kurşunla indirdi. $' || lost_cash
      || ' ve ' || lost_bullets || ' kurşun kaybettin, hastanelik oldun.');
    return jsonb_build_object('ok', true, 'success', true, 'killed', true, 'msg', msg);
  end if;

  -- need zaten kalan cana göre ölçekli: kurşun/need oranı kadar kalan canı götürür
  dmg := greatest(1, floor(t.health * p_bullets::numeric / need))::int;
  dmg := least(dmg, t.health - 1);
  update players set health = health - dmg where id = t.id;
  msg := t.nick || ' yaralandı ama ayakta. (' || p_bullets || ' kurşun)';
  perform log_event(p.id, msg);
  perform log_event(t.id, p.nick || ' sana kurşun yağdırdı! ' || dmg || ' can kaybettin.');
  return jsonb_build_object('ok', true, 'success', false, 'msg', msg);
end $$;

-- ─────────────── Hapishane ───────────────
create or replace function get_jail() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('nick', nick, 'rank', rank_of(xp), 'secs', secs_left(jail_until))
         order by jail_until desc), '[]')
  from (select * from players where jail_until > now() order by jail_until desc limit 50) j
$$;

create or replace function bust(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; chance numeric; msg text;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if p.bust_ready_at > now() then
    return jsonb_build_object('ok', false, 'msg', 'Gardiyanlar tetikte. ' || fmt_wait(p.bust_ready_at) || ' bekle.');
  end if;
  select * into t from players where lower(nick) = lower(p_nick) for update;
  if not found or t.jail_until <= now() then return jsonb_build_object('ok', false, 'msg', 'O artık içeride değil.'); end if;
  if t.id = p.id then return jsonb_build_object('ok', false, 'msg', 'Kendini kurtarmak için "Firar et"i kullan.'); end if;

  update players set bust_ready_at = now() + make_interval(secs => setting('bust_cooldown_s')) where id = p.id;
  chance := least(0.6, 0.25 + p.busts * 0.002);
  if random() < chance then
    update players set jail_until = now() where id = t.id;
    update players set busts = busts + 1, xp = xp + 10 where id = p.id;
    perform log_event(t.id, p.nick || ' seni hapisten kaçırdı!');
    return jsonb_build_object('ok', true, 'success', true, 'msg', t.nick || ' kurtarıldı! +10 itibar');
  elsif random() < 0.35 then
    update players set jail_until = now() + make_interval(secs => setting('bust_fail_jail_s')) where id = p.id;
    return jsonb_build_object('ok', true, 'success', false, 'jailed', true,
      'msg', 'Gardiyan seni de yakaladı! ' || setting('bust_fail_jail_s') || ' sn hapis.');
  end if;
  return jsonb_build_object('ok', true, 'success', false, 'msg', 'Kilidi açamadın, fark edilmeden sıvıştın.');
end $$;

create or replace function self_bust() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; tries int;
begin
  p := me_for_update();
  if p.jail_until <= now() then return jsonb_build_object('ok', false, 'msg', 'Zaten dışarıdasın.'); end if;
  tries := case when p.self_bust_for = p.jail_until then p.self_bust_left else 3 end;
  if tries <= 0 then return jsonb_build_object('ok', false, 'msg', 'Firar hakkın bitti, cezanı çek.'); end if;
  if random() < 0.15 then
    update players set jail_until = now(), self_bust_left = 3, self_bust_for = null where id = p.id;
    return jsonb_build_object('ok', true, 'success', true, 'msg', 'Parmaklıkları söktün, özgürsün!');
  end if;
  update players set self_bust_left = tries - 1, self_bust_for = p.jail_until where id = p.id;
  return jsonb_build_object('ok', true, 'success', false, 'msg', 'Firar başarısız. ' || (tries - 1) || ' hakkın kaldı.');
end $$;

-- ─────────────── Banka & transfer ───────────────
-- p_amount > 0 yatır (komisyonlu), < 0 çek
create or replace function bank_move(p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; fee bigint;
begin
  p := me_for_update();
  if p_amount = 0 then raise exception 'BAD_AMOUNT'; end if;
  if p.jail_until > now() then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if p_amount > 0 then
    if p.cash < p_amount then return jsonb_build_object('ok', false, 'msg', 'Cebinde o kadar yok.'); end if;
    fee := ceil(p_amount * setting('bank_fee'));
    update players set cash = cash - p_amount, bank = bank + p_amount - fee where id = p.id;
    return jsonb_build_object('ok', true, 'msg', '$' || (p_amount - fee) || ' yatırıldı (komisyon $' || fee || ').');
  end if;
  if p.bank < -p_amount then return jsonb_build_object('ok', false, 'msg', 'Hesabında o kadar yok.'); end if;
  update players set cash = cash - p_amount, bank = bank + p_amount where id = p.id;
  return jsonb_build_object('ok', true, 'msg', '$' || -p_amount || ' çekildi.');
end $$;

create or replace function send_money(p_nick text, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; fee bigint;
begin
  p := me_for_update();
  if p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if rank_of(p.xp) < 1 then return jsonb_build_object('ok', false, 'msg', 'Para göndermek için Ayak İşçisi olmalısın.'); end if;
  t := player_by_nick(p_nick);
  if t.id is null or t.id = p.id then return jsonb_build_object('ok', false, 'msg', 'Geçersiz alıcı.'); end if;
  if p.cash < p_amount then return jsonb_build_object('ok', false, 'msg', 'Cebinde o kadar yok.'); end if;
  fee := ceil(p_amount * setting('transfer_fee'));
  update players set cash = cash - p_amount where id = p.id;
  update players set cash = cash + p_amount - fee where id = t.id;
  perform log_event(p.id, 'Para gönderdin → ' || t.nick || ': $' || p_amount);
  perform log_event(t.id, p.nick || ' sana $' || (p_amount - fee) || ' gönderdi.');
  return jsonb_build_object('ok', true, 'msg', 'Gönderildi. Komisyon $' || fee || '.');
end $$;

-- ─────────────── Oyuncular ───────────────
create or replace function get_profile(p_nick text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t players;
begin
  t := player_by_nick(p_nick);
  if t.id is null then return null; end if;
  return jsonb_build_object(
    'nick', t.nick, 'rank', rank_of(t.xp), 'kills', t.kills, 'deaths', t.deaths, 'busts', t.busts,
    'online', t.last_seen > now() - interval '5 minutes',
    'status', case when t.hospital_until > now() then 'hastanede'
                   when t.jail_until > now() then 'hapiste' else 'serbest' end,
    'protected', rank_of(t.xp) < setting('protect_rank'),
    'est_bullets', (select kill_bullets from ranks where id = rank_of(t.xp)),
    'joined', t.created_at);
end $$;

create or replace function get_players() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'online', (select coalesce(jsonb_agg(jsonb_build_object('nick', nick, 'rank', rank_of(xp)) order by xp desc), '[]')
               from (select * from players where last_seen > now() - interval '5 minutes' order by xp desc limit 100) o),
    'top',    (select coalesce(jsonb_agg(jsonb_build_object('nick', nick, 'rank', rank_of(xp), 'kills', kills) order by xp desc), '[]')
               from (select * from players order by xp desc limit 20) t))
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function get_state(), create_player(text), do_crime(text), steal_car(), sell_car(bigint),
  travel(text), trade(text, int),
  buy_bullets(int), buy_weapon(text), hire_bodyguard(), practice(), heal(),
  hire_detectives(text, int), shoot(text, int), get_jail(), bust(text), self_bust(),
  bank_move(bigint), send_money(text, bigint), get_profile(text), get_players()
  to authenticated;
