-- 026: Hapis süresi reklam izleyerek yarıya indirilebilir (jeton ve kulüp hakkıyla olmaz).

create or replace function use_boost(p_target text, p_via text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; share numeric := setting('boost_share'); ready timestamptz; n int; label text;
begin
  p := me_for_update();
  if p_via not in ('ad', 'token', 'club') then raise exception 'BAD_VIA'; end if;
  if boosts_today(p.id) >= setting('boost_daily_cap') then return fail('Bugünlük hızlandırma hakkın doldu.'); end if;
  if p_via = 'ad' then
    if setting('ads_enabled') = 0 then return fail('Reklamla hızlandırma çok yakında.'); end if;
    if boosts_today(p.id, 'ad') >= setting('ad_boosts_daily') then return fail('Bugünkü reklam hakların bitti.'); end if;
  elsif p_via = 'club' then
    if not club_active(p.id) then return fail('Kulüp hakkı sadece üyelere.'); end if;
    if boosts_today(p.id, 'club') >= setting('club_boosts_daily') then return fail('Bugünkü kulüp hakların bitti.'); end if;
  elsif p.boost_tokens < 1 then return fail('Hızlandırma jetonun yok.');
  end if;

  if p_target = 'jail' then   -- 026: hapis sadece reklamla hızlanır (parayla hapisten çıkılmaz)
    if p_via <> 'ad' then return fail('Hapis sadece reklam izleyerek hızlandırılabilir.'); end if;
    if p.jail_until <= now() then return fail('Hapiste değilsin.'); end if;
    update players set jail_until = now() + (jail_until - now()) * (1 - share) where id = p.id; label := 'Hapis süren';
  elsif p_target like 'crime:%' then
    ready := cooldown_left(p.id, p_target);
    if ready is null then return fail('Bu iş zaten hazır.'); end if;
    update player_cooldowns set ready_at = now() + (ready_at - now()) * (1 - share) where player_id = p.id and kind = p_target;
    label := (select name from crimes where 'crime:' || id = p_target);
  elsif p_target = 'car' then
    if p.car_ready_at <= now() then return fail('Araba zaten hazır.'); end if;
    update players set car_ready_at = now() + (car_ready_at - now()) * (1 - share) where id = p.id; label := 'Araba';
  elsif p_target = 'travel' then
    if p.travel_ready_at <= now() then return fail('Vapur zaten hazır.'); end if;
    update players set travel_ready_at = now() + (travel_ready_at - now()) * (1 - share) where id = p.id; label := 'Sefer';
  elsif p_target = 'men' then
    update player_men set ready_at = now() + (ready_at - now()) * (1 - share) where player_id = p.id and ready_at > now();
    get diagnostics n = row_count;
    if n = 0 then return fail('Eğitimde adamın yok.'); end if;
    label := 'Adam eğitimi';
  else raise exception 'BAD_TARGET';
  end if;

  if p_via = 'token' then update players set boost_tokens = boost_tokens - 1 where id = p.id; end if;
  insert into boost_log values (p.id, (now() at time zone 'Europe/Istanbul')::date, p_via, 1)
    on conflict (player_id, day, via) do update set n = boost_log.n + 1;
  return done(label || ' hızlandı: kalan süre yarıya indi.');
end $$;

select apply_grants();
