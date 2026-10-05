-- 031: İnfaz önizlemesi (gereken kurşun tahmini) ve Defter'de en zengin oyuncular. Tekrar çalıştırılabilir.

-- Vurmadan önce: hedefin seni durduracak gücü. Kesin sayı değil, ±%10 aralık (istihbarat); sıktığın kurşun aralığın
-- üstündeyse kesin ölür, altındaysa sadece yaralanır. Hedefi bu şehirde dedektiflerin bulmuş olmalı.
create or replace function shoot_preview(p_nick text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p players; t players; need int; base int; found boolean;
begin
  select * into p from players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  t := player_by_nick(p_nick);
  if t.id is null then return fail('Böyle biri yok.'); end if;
  found := exists (select 1 from detective_searches where player_id = p.id and target_id = t.id
                   and resolved and success and city_found = p.city_id and ready_at > now() - interval '1 hour');
  if not found then return fail('Önce dedektiflerin onu bu şehirde bulmalı.'); end if;
  need := greatest(1, required_bullets(t, p));
  select kill_bullets into base from ranks where id = rank_of(t.xp);
  return jsonb_build_object('ok', true, 'nick', t.nick, 'rank', rank_of(t.xp),
    'low', (floor(need * 0.9 / 10) * 10)::int, 'high', (ceil(need * 1.1 / 10) * 10)::int,
    'base', base, 'bodyguards', t.bodyguards,
    'men_guard', round(men_guard(t.id) * 100),            -- adamlarının koruması (%)
    'health', t.health,
    'weapon_mult', coalesce((select bullet_mult from weapons where id = p.weapon_id), 1),
    'skill_cut', round(least(p.kill_skill, 100) / 2.5),     -- nişancılığının indirimi (%)
    'have', p.bullets, 'in_hospital', t.hospital_until > now(), 'protected', rank_of(t.xp) < setting('protect_rank'));
end $$;

-- En zengin oyuncular (cep + banka)
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'players_avatar') then alter function get_players() rename to players_avatar; end if;
end $$;
create or replace function get_players() returns jsonb
language sql stable security definer set search_path = public as $$
  select players_avatar() || jsonb_build_object('rich', (select coalesce(jsonb_agg(x order by (x->>'wealth')::bigint desc), '[]') from (
    select jsonb_build_object('nick', nick, 'avatar', avatar, 'rank', rank_of(xp), 'wealth', cash + bank) x
    from players where banned_until is null or banned_until < now()
    order by cash + bank desc limit 10) q))
$$;

insert into api_rpcs values ('shoot_preview(text)') on conflict do nothing;
select apply_grants();
