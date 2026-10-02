-- 023: Can/hasar ile baskın savaşı.
-- man_types.attack artık HASAR, man_types.defense artık CAN anlamına gelir (aynı sütunlar, yeni değerler).
--   Zorba: çok can, az hasar · Fedai: dengeli ve biraz daha güçlü (pahalı, uzun eğitim) · Nişancı: çok hasar, az can · Gözcü: aynı
-- Savaş en fazla 5 tur sürer. Her turda iki taraf aynı anda vurur (±%15 şans). Hasar önce barikata, sonra adamlara gider;
-- canı biten adam ölür. Toplam canının yarısını kaybeden taraf dağılır. 5 tur biterse kalan can oranı yüksek olan kazanır.
-- Kurşun: saldıranın her 100 kurşunu tur başına +1 hasar. Mekâna bırakılan kurşun barikat olur (can + biraz hasar).
-- Savunan +%25 hasarla vurur. Sahipsiz mekânı "yerel kabadayılar" korur.

update man_types set attack = v.dmg, defense = v.hp, price = v.price, wage_week = v.wage,
  train_min = v.tmin, train_max = v.tmax, min_rank = v.rk, descr = v.descr
from (values
  ('zorba',   2,   20, 2000,  700, 15, 20, 0, 'İri yarı; çok dayanır, az vurur. İyi kalkan.'),
  ('fedai',   4,   15, 3500, 1000, 25, 30, 1, 'Dengeli ve sadık; hem dayanır hem vurur.'),
  ('gozcu',   0.5,  5, 1500,  500, 15, 20, 0, 'Polisi kollar; işlerde başarı şansını artırır.'),
  ('nisanci', 9,    6, 3000,  900, 20, 25, 3, 'Uzaktan çok sert vurur ama kolay düşer.')
) v(id, dmg, hp, price, wage, tmin, tmax, rk, descr) where man_types.id = v.id;

insert into game_settings values
  ('men_guard_bonus',   0.003),   -- boştaki adamların her can puanı seni vurmayı %0,3 zorlaştırır
  ('battle_rounds',         5),
  ('battle_break',        0.5),   -- canının yarısını kaybeden dağılır
  ('battle_def_bonus',   1.25),
  ('battle_bullet_div',   100),   -- saldıranın 100 kurşunu = tur başına 1 hasar
  ('battle_wall_hp_div',   10),   -- mekân kurşunu / 10 = barikat canı
  ('battle_wall_dmg_div', 200),   -- mekân kurşunu / 200 = barikatın tur başına hasarı
  ('battle_npc_per',     1000),   -- sahipsiz mekânda her 1000$ saatlik gelir için bir yerel kabadayı
  ('battle_npc_hp',        12),
  ('battle_npc_dmg',        2)
on conflict (key) do update set value = excluded.value;

-- Güç = can × hasar / 4 (sıralama ve aile gücü)
create or replace function men_total_power(pid uuid) returns numeric
language sql stable as $$
  select coalesce(sum(t.attack * t.defense / 4), 0) from player_men m join man_types t on t.id = m.type_id
  where m.player_id = pid and m.ready_at <= now()
$$;

-- Bir tarafın verdiği hasarı karşı tarafa sırayla uygular (önce barikat, sonra adamlar)
create or replace function battle_hit(hp numeric[], dmg numeric) returns numeric[]
language plpgsql immutable as $$
declare i int := 1; n int := coalesce(array_length(hp, 1), 0);
begin
  while dmg > 0 and i <= n loop
    if hp[i] > 0 then
      if dmg >= hp[i] then dmg := dmg - hp[i]; hp[i] := 0; else hp[i] := hp[i] - dmg; dmg := 0; end if;
    end if;
    i := i + 1;
  end loop;
  return hp;
end $$;

create or replace function raid_spot_events(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; s spots; f families; allies int; defenders int := 0; msg text; prev_owner bigint; fname text;
        a_id bigint[]; a_hp numeric[]; a_dm numeric[];
        d_id bigint[]; d_hp numeric[]; d_dm numeric[]; d_kind text[];
        a_hp0 numeric; d_hp0 numeric; a_mult numeric; d_mult numeric; support numeric; bullet_dmg numeric;
        ad numeric; dd numeric; before_a int; before_d int; rounds jsonb := '[]'; r int; win boolean := null;
        lost_me int := 0; lost_def int := 0; wall_broken boolean := false; npc int;
begin
  perform collect_spots();
  p := me_for_update();
  perform settle_men(p.id);
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p.family_role is null or p.family_role not in ('don', 'sottocapo', 'capo') then
    return fail('Baskını ancak Don, Sottocapo ya da bir Capo yönetebilir.');
  end if;
  -- saldıran: boştaki eğitimli adamlar, rastgele sırada (hasar sırayla dağılır)
  select array_agg(x.id order by x.r), array_agg(x.hp order by x.r), array_agg(x.dm order by x.r) into a_id, a_hp, a_dm
    from (select m.id, t.defense hp, t.attack dm, random() r from player_men m join man_types t on t.id = m.type_id
          where m.player_id = p.id and m.ready_at <= now() and m.spot_id is null and not t.scout) x;   -- gözcüler baskına girmez
  if p_bullets < 0 or (p_bullets = 0 and a_id is null) then return fail('Kaç kurşunla gireceğini yaz ya da yanına adam al.'); end if;
  if p.bullets < p_bullets then return fail('O kadar kurşunun yok.'); end if;
  select * into s from spots where id = p_spot for update;
  if not found then raise exception 'BAD_SPOT'; end if;
  if s.city_id <> p.city_id then return fail('Baskın için mekânın şehrinde olmalısın.'); end if;
  if s.owner_family = p.family_id then return fail('Burası zaten sizin.'); end if;
  if s.protected_until > now() then return fail('Mekân yeni el değiştirdi; ' || fmt_wait(s.protected_until) || ' sonra.'); end if;
  select * into f from families where id = p.family_id for update;
  if f.raid_ready_at > now() then return fail('Ailen yeni baskın yaptı; ' || fmt_wait(f.raid_ready_at) || ' bekle.'); end if;

  -- Savunan taraf: barikat (mekân kurşunu) + nöbetçiler, ya da yerel kabadayılar
  d_id := '{}'; d_hp := '{}'; d_dm := '{}'; d_kind := '{}';
  if s.owner_family is null then
    npc := greatest(2, s.income / setting('battle_npc_per'))::int;
    d_id := array_fill(null::bigint, array[npc]); d_hp := array_fill(setting('battle_npc_hp'), array[npc]);
    d_dm := array_fill(setting('battle_npc_dmg'), array[npc]); d_kind := array_fill('npc'::text, array[npc]);
  else
    defenders := online_in_city(s.owner_family, s.city_id);
    if s.defense > 0 then   -- şehirde çevrimiçi savunucular barikatı da güçlendirir
      d_id := array[null::bigint]; d_hp := array[s.defense / setting('battle_wall_hp_div') * (1 + setting('raid_ally_bonus') * defenders)];
      d_dm := array[s.defense / setting('battle_wall_dmg_div')]; d_kind := array['wall'];
    end if;
    select d_id || coalesce(array_agg(x.id order by x.r), '{}'), d_hp || coalesce(array_agg(x.hp order by x.r), '{}'),
           d_dm || coalesce(array_agg(x.dm order by x.r), '{}'), d_kind || coalesce(array_agg('man'::text order by x.r), '{}')
      into d_id, d_hp, d_dm, d_kind
      from (select m.id, t.defense hp, t.attack dm, random() r from player_men m join man_types t on t.id = m.type_id
              join players pl on pl.id = m.player_id
            where m.spot_id = s.id and m.ready_at <= now() and pl.family_id = s.owner_family) x;
  end if;

  allies := online_in_city(p.family_id, p.city_id);
  a_hp := coalesce(a_hp, '{}'); a_dm := coalesce(a_dm, '{}'); a_id := coalesce(a_id, '{}');
  a_mult := 1 + setting('raid_ally_bonus') * greatest(0, allies - 1);
  d_mult := setting('battle_def_bonus') * (1 + setting('raid_ally_bonus') * defenders);
  support := setting('men_support_share') * coalesce((select sum(men_free_power(id, 'attack')) from players
                                                       where family_id = p.family_id and id <> p.id), 0);
  bullet_dmg := p_bullets / setting('battle_bullet_div');
  a_hp0 := coalesce((select sum(x) from unnest(a_hp) x), 0);
  d_hp0 := coalesce((select sum(x) from unnest(d_hp) x), 0);

  update players set bullets = bullets - p_bullets where id = p.id;
  update families set raid_ready_at = now() + make_interval(secs => setting('raid_cooldown_s')) where id = f.id;
  prev_owner := s.owner_family;

  if d_hp0 = 0 then win := true; end if;   -- savunmasız mekân
  for r in 1 .. setting('battle_rounds')::int loop
    exit when win is not null;
    -- iki taraf aynı anda vurur
    ad := ((select coalesce(sum(d), 0) from unnest(a_hp, a_dm) u(h, d) where h > 0) + bullet_dmg + support) * a_mult * (0.85 + random() * 0.3);
    dd := (select coalesce(sum(d), 0) from unnest(d_hp, d_dm) u(h, d) where h > 0) * d_mult * (0.85 + random() * 0.3);
    before_a := (select count(*) from unnest(a_hp) x where x > 0);
    before_d := (select count(*) from unnest(d_hp, d_kind) u(h, k) where h > 0 and k <> 'wall');
    d_hp := battle_hit(d_hp, ad);
    a_hp := battle_hit(a_hp, dd);
    if not wall_broken and exists (select 1 from unnest(d_hp, d_kind) u(h, k) where k = 'wall' and h = 0) then wall_broken := true; end if;
    rounds := rounds || jsonb_build_object('round', r,
      'att_lost', before_a - (select count(*) from unnest(a_hp) x where x > 0),
      'def_lost', before_d - (select count(*) from unnest(d_hp, d_kind) u(h, k) where h > 0 and k <> 'wall'),
      'wall', wall_broken);
    if (select coalesce(sum(x), 0) from unnest(d_hp) x) <= d_hp0 * (1 - setting('battle_break')) then win := true;
    elsif a_hp0 > 0 and (select coalesce(sum(x), 0) from unnest(a_hp) x) <= a_hp0 * (1 - setting('battle_break')) then win := false;
    end if;
  end loop;
  if win is null then   -- turlar bitti: kalan can oranı yüksek olan kazanır; sadece kurşunla giren kıramadıysa kaybeder
    win := a_hp0 > 0 and (select coalesce(sum(x), 0) from unnest(a_hp) x) / a_hp0 > (select coalesce(sum(x), 0) from unnest(d_hp) x) / d_hp0;
  end if;

  -- Ölüler: canı biten adamlar silinir
  delete from player_men where id in (select i from unnest(a_id, a_hp) u(i, h) where h <= 0);
  get diagnostics lost_me = row_count;
  delete from player_men where id in (select i from unnest(d_id, d_hp) u(i, h) where i is not null and h <= 0);
  get diagnostics lost_def = row_count;
  if s.owner_family is null then lost_def := (select count(*) from unnest(d_hp) x where x <= 0); end if;

  if win then
    update player_men set spot_id = null where spot_id = s.id;   -- sağ kalan nöbetçiler evine döner
    update spots set owner_family = f.id, defense = floor(p_bullets * 0.25), collected_at = now(),
      protected_until = now() + make_interval(secs => setting('spot_protect_s')) where id = s.id;
    msg := s.name || ' baskınla ele geçirildi!'
      || case when lost_me > 0 then ' Kaybın: ' || lost_me || ' adam.' else '' end
      || case when lost_def > 0 then ' Karşı taraf ' || lost_def || ' adam kaybetti.' else '' end;
    perform family_msg(f.id, null, p.nick || ' liderliğinde ' || msg);
    if prev_owner is not null then
      select name into fname from families where id = f.id;
      perform family_msg(prev_owner, null, s.name || ' ' || fname || ' ailesinin baskınıyla elimizden çıktı!'
        || case when lost_def > 0 then ' Nöbetçilerden ' || lost_def || ' kişi düştü.' else '' end);
    end if;
  else
    if prev_owner is not null then
      update spots set defense = greatest(0, defense - floor(p_bullets * 0.5)) where id = s.id;
      select name into fname from families where id = f.id;
      perform family_msg(prev_owner, null, fname || ' ailesi ' || s.name || ' mekânına baskın yaptı ama püskürtüldü.'
        || case when lost_def > 0 then ' Nöbetçilerden ' || lost_def || ' kişi düştü.' else '' end);
    end if;
    msg := s.name || ' baskını püskürtüldü.'
      || case when lost_me > 0 then ' Kaybın: ' || lost_me || ' adam.' else '' end
      || case when lost_def > 0 then ' Karşı taraf ' || lost_def || ' adam kaybetti.' else '' end;
    perform family_msg(f.id, null, p.nick || ': ' || msg);
  end if;
  return jsonb_build_object('ok', true, 'success', win, 'msg', msg, 'lost', lost_me, 'enemy_lost', lost_def,
    'rounds', rounds, 'att_men', coalesce(array_length(a_id, 1), 0),
    'def_men', (select count(*) from unnest(d_kind) k where k <> 'wall'), 'wall', 'wall' = any(d_kind));
end $$;

select apply_grants();
