-- 040: Serseri çetesi baskınları yumuşatıldı (oyuncu geri bildirimi: "çok can yakıyor"). Tekrar çalıştırılabilir.
-- • Daha seyrek: 4–8 saat yerine 6–12 saatte bir.
-- • Daha zayıf: saldırı çarpanı 3–8 yerine 2–5 (ortalama ~%36 daha az güç).
-- • Püskürtülen baskın barikattan daha az kurşun götürür: güç×10×0,5 yerine güç×10×0,3.
-- • Barikat aşılırsa: barikat sıfırlanmaz, yarısı kalır; kasadan bir saatlik değil yarım saatlik haraç gider;
--   fabrikada stoğun yarısı değil dörtte biri yağmalanır.
-- • Hiç savunma yoksa mekân yine elden çıkar (tahkim etmenin anlamı kalsın).
-- Yeni sayılar ayar tablosunda: ileride SQL'de tek satırla ince ayar yapılabilir.

update game_settings set value = 6   where key = 'npc_raid_min_h';
update game_settings set value = 12  where key = 'npc_raid_max_h';
update game_settings set value = 2   where key = 'npc_raid_min';
update game_settings set value = 5   where key = 'npc_raid_max';
update game_settings set value = 0.3 where key = 'npc_raid_wear';
insert into game_settings values
  ('npc_loot_hours',     0.5),    -- barikat aşılınca kasadan giden haraç (saatlik gelirin katı)
  ('npc_factory_loot',   0.25),   -- barikat aşılınca fabrikadan yağmalanan stok oranı
  ('npc_rob_wall_keep',  0.5)     -- barikat aşılınca barikatta kalan oran
on conflict (key) do nothing;

create or replace function npc_raids() returns void
language plpgsql as $$
declare s spots; hp numeric; atk numeric; wear int; loot bigint; msg text; nxt timestamptz; fam bigint; keep int;
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
      keep := floor(s.defense * setting('npc_rob_wall_keep'))::int;
      if s.kind = 'fabrika' then
        update city_bullets set stock = stock - floor(stock * setting('npc_factory_loot'))::int where city_id = s.city_id;
        msg := 'Serseriler ' || s.name || ' barikatını aşıp depodaki kurşunların bir kısmını yağmaladı.';
      else
        select least(bank, floor(s.income * setting('npc_loot_hours'))::bigint) into loot from families where id = fam;
        update families set bank = bank - loot where id = fam;
        msg := 'Serseriler ' || s.name || ' barikatını aşıp kasadan $' || loot || ' haraç yağmaladı.';
      end if;
      msg := msg || case when keep > 0 then ' Barikatın yarısı ayakta kaldı.' else ' Barikat yıkıldı.' end;
      update spots set defense = keep, npc_at = nxt where id = s.id;
    else
      update spots set owner_family = null where id = s.id;   -- tetikleyiciler: barikat sıfır, fabrikada sahiplik de düşer
      msg := s.name || ' korumasız kaldı; serseriler bastı ve elimizden çıktı. Mekânları boş bırakmayın: tahkim edin ya da nöbetçi bırakın.';
    end if;
    perform family_msg(fam, null, msg);
  end loop;
end $$;
