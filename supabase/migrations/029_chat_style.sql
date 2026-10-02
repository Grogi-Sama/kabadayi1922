-- 029: Sohbet görünümü (mağaza): özel yazı tipleri ve isim çerçeveleri. Sadece kozmetik. Tekrar çalıştırılabilir.

alter table products drop constraint if exists products_kind_check;
alter table products add constraint products_kind_check
  check (kind in ('portrait', 'crest', 'club', 'boosts', 'chatfont', 'chatframe'));
insert into products values
  ('font_zarif',   'chatfont',  'Zarif (italik)',      19.99, null, null, 41),
  ('font_saray',   'chatfont',  'Saray',               19.99, null, null, 42),
  ('font_daktilo', 'chatfont',  'Daktilo',             19.99, null, null, 43),
  ('font_mektup',  'chatfont',  'Mektup (el yazısı)',  19.99, null, null, 44),
  ('frame_altin',  'chatframe', 'Altın çerçeve',       24.99, null, null, 51),
  ('frame_bordo',  'chatframe', 'Bordo kurdele',       24.99, null, null, 52),
  ('frame_deco',   'chatframe', 'Art-deco',            24.99, null, null, 53),
  ('frame_gece',   'chatframe', 'Gece gümüşü',         24.99, null, null, 54)
on conflict (id) do nothing;

alter table players add column if not exists chat_font  text references products(id);
alter table players add column if not exists chat_frame text references products(id);

-- Satın alınan kozmetikler (sohbet görünümü dahil) envantere girer
create or replace function grant_product(pid uuid, prod text, src text, p_receipt text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr products;
begin
  select * into pr from products where id = prod;
  if pr.id is null then raise exception 'BAD_PRODUCT'; end if;
  insert into purchases (player_id, product_id, source, receipt) values (pid, prod, src, p_receipt);
  if pr.kind in ('portrait', 'crest', 'chatfont', 'chatframe') then
    insert into player_items (player_id, product_id) values (pid, prod) on conflict do nothing;
  elsif pr.kind = 'club' then
    update players set club_until = greatest(coalesce(club_until, now()), now()) + make_interval(days => pr.ref) where id = pid;
    perform log_event(pid, 'Kabadayı Kulübü üyeliğin başladı. Hoş geldin!');
  elsif pr.kind = 'boosts' then
    update players set boost_tokens = boost_tokens + pr.ref where id = pid;
  end if;
end $$;

-- Kulübün aylık hediyesi sohbet görünümü de olabilir
create or replace function club_claim(p_product text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; pr products;
begin
  p := me_for_update();
  if not club_active(p.id) then return fail('Bu hediye Kulüp üyelerine özel.'); end if;
  if p.club_pick_at > now() - make_interval(days => setting('club_days')::int) then
    return fail('Bu ayın hediyesini aldın. Sıradaki: ' || to_char(p.club_pick_at + make_interval(days => setting('club_days')::int), 'DD.MM.YYYY') || '.');
  end if;
  select * into pr from products where id = p_product and kind in ('portrait', 'crest', 'chatfont', 'chatframe');
  if pr.id is null then return fail('Bu ürün hediye olarak seçilemez.'); end if;
  if owns(p.id, pr.id) then return fail('Bu zaten sende.'); end if;
  perform grant_product(p.id, pr.id, 'club');
  update players set club_pick_at = now() where id = p.id;
  return done(pr.name || ' artık senin. Kulübe hoş geldin!');
end $$;

-- Yazı tipi / çerçeve seç (boş = varsayılan)
create or replace function set_chat_style(p_font text, p_frame text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; f text := nullif(p_font, ''); fr text := nullif(p_frame, '');
begin
  p := me_for_update();
  if f is not null and (not owns(p.id, f) or not exists (select 1 from products where id = f and kind = 'chatfont')) then
    return fail('Bu yazı tipi sende yok.');
  end if;
  if fr is not null and (not owns(p.id, fr) or not exists (select 1 from products where id = fr and kind = 'chatframe')) then
    return fail('Bu çerçeve sende yok.');
  end if;
  update players set chat_font = f, chat_frame = fr where id = p.id;
  return done('Sohbet görünümün güncellendi.');
end $$;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'get_chat_club') then alter function get_chat(text) rename to get_chat_club; end if;
  if not exists (select 1 from pg_proc where proname = 'state_trade_level') then alter function get_state() rename to state_trade_level; end if;
end $$;

create or replace function get_chat(p_channel text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(m || coalesce((select jsonb_build_object('font', pl.chat_font, 'frame', pl.chat_frame)
                                           from players pl where pl.nick = m->>'nick'), '{}') order by i), '[]')
  from jsonb_array_elements(get_chat_club(p_channel)) with ordinality t(m, i)
$$;

create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb := state_trade_level();
begin
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  return jsonb_set(base, '{player}', (base->'player') || (select jsonb_build_object('chat_font', chat_font, 'chat_frame', chat_frame)
    from players where id = auth.uid()));
end $$;

insert into api_rpcs values ('set_chat_style(text, text)') on conflict do nothing;
select apply_grants();
