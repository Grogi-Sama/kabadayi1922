-- 033: Duyurular (güncelleme notları, planlı bakım, etkinlik, genel duyuru). Sadece Admin yazar; herkes okur. Tekrar çalıştırılabilir.

create table if not exists announcements (
  id         bigserial primary key,
  kind       text not null default 'duyuru' check (kind in ('guncelleme', 'bakim', 'etkinlik', 'duyuru')),
  title      text not null check (length(title) between 3 and 80),
  body       text not null check (length(body) between 3 and 3000),
  pinned     boolean not null default false,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table announcements enable row level security;

create or replace function get_announcements() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body,
           'pinned', a.pinned, 'at', a.created_at) order by a.pinned desc, a.id desc), '[]')
  from (select * from announcements order by pinned desc, id desc limit 40) a
$$;

create or replace function admin_announce(p_kind text, p_title text, p_body text, p_pinned boolean, p_notify boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text := trim(p_title); b text := trim(p_body); n int := 0; r record;
begin
  perform require_owner();
  if p_kind not in ('guncelleme', 'bakim', 'etkinlik', 'duyuru') then return fail('Tür seç.'); end if;
  if length(t) < 3 or length(t) > 80 then return fail('Başlık 3-80 karakter olmalı.'); end if;
  if length(b) < 3 or length(b) > 3000 then return fail('Metin 3-3000 karakter olmalı.'); end if;
  insert into announcements (kind, title, body, pinned, created_by) values (p_kind, t, b, coalesce(p_pinned, false), auth.uid());
  if p_notify then   -- bildirimleri açık oyunculara (oyunda olmayanlara) haber ver
    for r in select distinct player_id from push_subs loop
      perform queue_push(r.player_id, 'Duyuru: ' || t, left(b, 160), 'duyuru'); n := n + 1;
    end loop;
  end if;
  return done('Duyuru yayımlandı.' || case when p_notify then ' Bildirim kuyruğuna ' || n || ' oyuncu eklendi.' else '' end);
end $$;

create or replace function admin_announcement_pin(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  update announcements set pinned = not pinned where id = p_id;
  if not found then return fail('Duyuru yok.'); end if;
  return done('Sabitleme değişti.');
end $$;

create or replace function admin_announcement_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  delete from announcements where id = p_id;
  if not found then return fail('Duyuru yok.'); end if;
  return done('Duyuru silindi.');
end $$;

-- İlk duyuru: son güncellemenin özeti (bir kez)
insert into announcements (kind, title, body, pinned)
select 'guncelleme', 'Büyük güncelleme: adamlar, mağaza, ses ve bildirimler',
'Son güncellemeyle gelenler:
• Kahvehane: Zorba, Fedai, Gözcü ve Nişancı tut; eğitimden sonra yanına katılırlar, haftalık maaş isterler.
• Baskın artık can/hasar ile tur tur savaş. Girmeden önce iki tarafın gücünü ve kazanma ihtimalini gör.
• İnfaz ekranında hedefin gücü ve gereken kurşun aralığı.
• Ticaret puanı: pahalı mallar (konyak, viski, halı, mücevherat, silah parçaları) ticaret puanıyla açılır.
• Gümrüğe takılma ihtimali düştü: artık %5 (önceden %8).
• Konağın: adamların, arabaların, malın ve eşin tek yerde.
• Mağaza: özel portre, aile arması, sohbet yazı tipi ve isim çerçevesi; Kabadayı Kulübü.
• Ses ve müzik (Defter → Ayarlar), bildirimler, hesabını e-postana bağlama.
İyi oyunlar!', true
where not exists (select 1 from announcements);

-- Gümrüğe takılma ihtimali %8 → %5
update game_settings set value = 0.05 where key = 'customs_chance';

-- Kumarhane (zar, rulet, slot, kazı kazan) arası bekleme 3 sn → 1 sn
update game_settings set value = 1 where key = 'casino_cooldown_s';

insert into api_rpcs values ('get_announcements()'), ('admin_announce(text, text, text, boolean, boolean)'),
  ('admin_announcement_pin(bigint)'), ('admin_announcement_delete(bigint)') on conflict do nothing;
select apply_grants();
