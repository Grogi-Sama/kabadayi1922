-- 042: Üst rütbelerde itibar daha yavaş gelir (sezon 1 ay; hızlı oyuncu Baba'ya en erken 15–20 günde varsın).
-- • Kazanılan itibar, oyuncunun o anki rütbesine göre bir katsayıyla çarpılır. İlk rütbeler hızlı kalır
--   (yeni oyuncu ilk saatte üç rütbe atlayabilsin), Tetikçi'den sonra giderek yavaşlar.
-- • Rütbe eşikleri DEĞİŞMEZ: kimsenin rütbesi düşmez; sadece bundan sonraki ilerleme yavaşlar.
-- • Hesap (tüm işler paralel, yüksek tıklama): şimdiye kadar Baba ≈ 26 saat aktif oyun, bundan sonra ≈ 125 saat
--   (günde 6–8 saat oynayan biri 15–20 gün).
-- • Bütün itibar kaynaklarını kapsar (iş, kurtarma, araba, vurma…): oyuncunun kendi işlemiyle artan itibar
--   tetikleyicide ölçeklenir. Yönetim düzeltmeleri ve ekip paylaşımları ölçeklenmez. Tekrar çalıştırılabilir.

alter table ranks add column if not exists xp_rate numeric not null default 1;
update ranks set xp_rate = v.r from (values (0, 1), (1, 1), (2, 1), (3, 0.7), (4, 0.45), (5, 0.35),
  (6, 0.25), (7, 0.2), (8, 0.16), (9, 0.16)) v(id, r) where ranks.id = v.id;

create or replace function xp_rate(p_xp int) returns numeric
language sql stable as $$ select xp_rate from ranks where id = rank_of(p_xp) $$;

-- Ölçeklenmiş kazanç (en az 1)
create or replace function xp_gain(p_xp int, amount int) returns int
language sql stable as $$ select case when amount <= 0 then amount else greatest(1, round(amount * xp_rate(p_xp)))::int end $$;

create or replace function scale_xp_gain() returns trigger
language plpgsql as $$
begin
  if new.xp > old.xp and new.id = auth.uid() and coalesce(current_setting('kb.xp_raw', true), '') <> '1' then
    new.xp := old.xp + xp_gain(old.xp, new.xp - old.xp);
  end if;
  return new;
end $$;
drop trigger if exists scale_xp_gain on players;
create trigger scale_xp_gain before update of xp on players for each row execute function scale_xp_gain();

-- İş: kazanç mesajda doğru görünsün diye burada ölçeklenir (tetikleyici atlanır). 041'deki do_crime + xp_gain
create or replace function do_crime(p_crime text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; c crimes; rk int; reward int; xg int; msg text; k text; ready timestamptz; jail int;
begin
  p := me_for_update();
  select * into c from crimes where id = p_crime;
  if not found then raise exception 'BAD_CRIME'; end if;
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  k := 'crime:' || c.id;
  ready := cooldown_left(p.id, k);
  if ready is not null then return fail('Bu iş için biraz bekle. ' || fmt_wait(ready) || ' kaldı.'); end if;
  rk := rank_of(p.xp);
  if rk < c.min_rank then return fail('Bu iş için rütben yetmiyor.'); end if;

  perform set_cooldown(p.id, k, ceil(c.cooldown_s * (1 - skill_val(p.id, 'y_golge')))::int);

  if random() < crime_chance_xp(c, p.xp) * ev_crime_chance(p.city_id) then
    reward := floor((c.reward_min + floor(random() * (c.reward_max - c.reward_min + 1))) * ev_crime_reward(p.city_id)
                    * (1 + skill_val(p.id, 'y_ganimet')))::int;
    xg := xp_gain(p.xp, round(c.xp * ev_crime_xp())::int);
    perform set_config('kb.xp_raw', '1', true);
    update players set cash = cash + reward, xp = xp + xg where id = p.id;
    perform set_config('kb.xp_raw', '', true);
    msg := c.name || ': başarılı! $' || reward || ' ve +' || xg || ' itibar kazandın.';
    if rank_of(p.xp + xg) > rk then
      msg := msg || ' Terfi ettin: ' || (select name from ranks where id = rank_of(p.xp + xg)) || '!';
    end if;
    if char_level(p.xp + xg) > char_level(p.xp) then
      msg := msg || ' Seviye ' || char_level(p.xp + xg) || '! Yetenek puanı kazandın.';
    end if;
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg, 'reward', reward, 'xp', xg);
  elsif random() < 0.5 then
    jail := greatest(1, ceil(c.jail_s * (1 - skill_val(p.id, 'y_kaygan'))))::int;
    update players set jail_until = now() + make_interval(secs => jail) where id = p.id;
    msg := c.name || ': polis yakaladı! ' || jail || ' sn hapis.';
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', false, 'jailed', true, 'msg', msg);
  else
    return jsonb_build_object('ok', true, 'success', false, 'msg', c.name || ': iş yaş, eli boş döndün ama kaçmayı başardın.');
  end if;
end $$;

-- Ekrandaki işlerde gösterilen itibar da ölçekli olsun; oyuncu kendi katsayısını görsün
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'state_skills') then alter function get_state() rename to state_skills; end if;
end $$;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb; p players;
begin
  base := state_skills();
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  select * into p from players where id = auth.uid();
  if jsonb_typeof(base->'crimes') = 'array' then
    base := jsonb_set(base, '{crimes}', (select jsonb_agg(c || jsonb_build_object('xp', xp_gain(p.xp, (c->>'xp')::int)) order by i)
      from jsonb_array_elements(base->'crimes') with ordinality t(c, i)));
  end if;
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object('xp_rate', xp_rate(p.xp)));
end $$;

select apply_grants();
