-- Sadece yerel geliştirme modu: tek başına test ederken dünyada birkaç kişi olsun.
-- Gerçek Supabase'de ÇALIŞTIRILMAZ.
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000b3'), ('00000000-0000-0000-0000-0000000000b4');
insert into players (id, nick, city_id, cash, xp, bullets, bodyguards, jail_until, last_seen) values
  ('00000000-0000-0000-0000-0000000000b1', 'Rıza_Baba',   'izmir',    80000, 13000, 2000, 2, now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', 'Kör_Salih',   'istanbul',  6000,   800,  150, 0, now(), now()),
  ('00000000-0000-0000-0000-0000000000b3', 'Topal_Osman', 'istanbul',  2500,  1600,  300, 1, now() + interval '2 hours', now()),
  ('00000000-0000-0000-0000-0000000000b4', 'Çırak_Nuri',  'selanik',    300,    40,    0, 0, now(), now() - interval '1 day');

-- Örnek bir aile ve kelle ilanı
insert into families (name, bank) values ('Karaköy Çetesi', 400000);
update players set family_id = (select id from families where name = 'Karaköy Çetesi'), family_role = 'don' where nick = 'Rıza_Baba';
update players set family_id = (select id from families where name = 'Karaköy Çetesi'), family_role = 'asker' where nick = 'Kör_Salih';
update city_bullets set owner_family = (select id from families where name = 'Karaköy Çetesi'), price = 8 where city_id = 'izmir';
insert into family_messages (family_id, player_id, text)
  select f.id, p.id, 'İzmir fabrikası bizde, kurşunu oradan alın.' from families f, players p
  where f.name = 'Karaköy Çetesi' and p.nick = 'Rıza_Baba';
insert into bounties (target_id, placer_id, amount)
  select t.id, p.id, 15000 from players t, players p where t.nick = 'Topal_Osman' and p.nick = 'Rıza_Baba';

-- Örnek şikâyet (admin panelini denemek için)
insert into messages (from_id, to_id, text)
  select a.id, b.id, 'Senin gibi çaylakları Haliç''e atarım, ***!' from players a, players b where a.nick = 'Topal_Osman' and b.nick = 'Kör_Salih';
insert into reports (reporter_id, target_id, kind, ref_id, snapshot, reason)
  select b.id, a.id, 'message', m.id, m.text, 'tehdit ve küfür'
  from players a, players b, messages m where a.nick = 'Topal_Osman' and b.nick = 'Kör_Salih' and m.from_id = a.id;
