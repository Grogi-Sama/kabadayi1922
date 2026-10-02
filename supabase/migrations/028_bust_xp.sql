-- 028: Hapisten firar başarılı olunca itibar kazanılır (tekrar çalıştırılabilir).

insert into game_settings values ('self_bust_xp', 5)
on conflict (key) do update set value = excluded.value;

create or replace function self_bust() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; tries int; xg int := setting('self_bust_xp')::int; msg text;
begin
  p := me_for_update();
  if p.jail_until <= now() then return jsonb_build_object('ok', false, 'msg', 'Zaten dışarıdasın.'); end if;
  tries := case when p.self_bust_for = p.jail_until then p.self_bust_left else 3 end;
  if tries <= 0 then return jsonb_build_object('ok', false, 'msg', 'Firar hakkın bitti, cezanı çek.'); end if;
  if random() < 0.15 then
    update players set jail_until = now(), self_bust_left = 3, self_bust_for = null, xp = xp + xg where id = p.id;
    msg := 'Parmaklıkları söktün, özgürsün! +' || xg || ' itibar.';
    if rank_of(p.xp + xg) > rank_of(p.xp) then
      msg := msg || ' Terfi ettin: ' || (select name from ranks where id = rank_of(p.xp + xg)) || '!';
    end if;
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg, 'xp', xg);
  end if;
  update players set self_bust_left = tries - 1, self_bust_for = p.jail_until where id = p.id;
  return jsonb_build_object('ok', true, 'success', false, 'msg', 'Firar başarısız. ' || (tries - 1) || ' hakkın kaldı.');
end $$;

select apply_grants();
