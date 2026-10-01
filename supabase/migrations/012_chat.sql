-- Sohbet sekmesi: herkese açık genel sohbet + her şehrin kendi sohbeti (aile sohbeti 003'te).
-- Küfür filtresi (clean_text), susturma (mute_msg), engelleme (is_blocked), şikâyet ve admin silme bu mesajlar için de geçerli.

create table chat_messages (
  id         bigserial primary key,
  channel    text not null check (channel = 'global' or channel like 'city:%'),
  player_id  uuid not null references players(id) on delete cascade,
  text       text not null check (length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
create index on chat_messages (channel, id desc);
create index on chat_messages (player_id, created_at desc);
alter table chat_messages enable row level security;

-- 'global' ya da 'city' (oyuncunun bulunduğu şehir); başka şehrin sohbetine yazılamaz
create or replace function chat_channel(p_channel text, p players) returns text
language sql immutable as $$
  select case p_channel when 'global' then 'global' when 'city' then 'city:' || p.city_id end
$$;

create or replace function send_chat(p_channel text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; ch text; txt text := trim(p_text);
begin
  p := me_for_update();
  ch := chat_channel(p_channel, p);
  if ch is null then raise exception 'BAD_CHANNEL'; end if;
  if mute_msg(p.id) is not null then return fail(mute_msg(p.id)); end if;
  if length(txt) = 0 then return fail('Boş mesaj.'); end if;
  if length(txt) > 300 then return fail('Mesaj en fazla 300 karakter.'); end if;
  if (select count(*) from chat_messages where player_id = p.id and created_at > now() - interval '30 seconds') >= 3 then
    return fail('Çok hızlı yazıyorsun, biraz bekle.');
  end if;
  insert into chat_messages (channel, player_id, text) values (ch, p.id, clean_text(txt));
  return jsonb_build_object('ok', true);
end $$;

-- Son 50 mesaj (eskiden yeniye); engellediğin oyuncuların mesajları görünmez
create or replace function get_chat(p_channel text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p players; ch text;
begin
  select * into p from players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  ch := chat_channel(p_channel, p);
  if ch is null then raise exception 'BAD_CHANNEL'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nick', a.nick, 'avatar', a.avatar, 'text', m.text,
            'at', m.created_at, 'mine', m.player_id = p.id) order by m.id), '[]')
          from (select * from chat_messages where channel = ch
                  and not is_blocked(p.id, player_id) order by id desc limit 50) m
          join players a on a.id = m.player_id);
end $$;

insert into api_rpcs values ('send_chat(text, text)'), ('get_chat(text)');
select apply_grants();
