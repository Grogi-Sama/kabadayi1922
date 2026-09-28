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
