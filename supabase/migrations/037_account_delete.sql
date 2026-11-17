-- 037: Hesap silme (Google Play ve App Store zorunluluğu). Tekrar çalıştırılabilir.
-- Oyuncu takma adını aynen yazarak onaylar. Giriş kaydı (auth.users) silinir; players ve ona bağlı her şey
-- yabancı anahtarlarla kendiliğinden silinir ya da boşaltılır (mesajlar, araçlar, adamlar, olaylar, öneriler…).
-- Aile Donuysa Donluk en kıdemli üyeye geçer; tek kişilik aile dağılır. Ban'lı oyuncu da hesabını silebilir.

create or replace function delete_my_account(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; succ players;
begin
  select * into p from players where id = auth.uid() for update;
  if p.id is null then
    -- karakteri olmayan giriş kaydı (ör. sadece misafir oturumu): onu da sil
    delete from auth.users where id = auth.uid();
    return done('Hesabın silindi.');
  end if;
  if lower(trim(coalesce(p_confirm, ''))) <> lower(p.nick) then
    return fail('Onaylamak için takma adını aynen yaz: ' || p.nick);
  end if;

  if p.family_id is not null then
    if p.family_role = 'don' then
      select * into succ from players where family_id = p.family_id and id <> p.id
       order by array_position(array['sottocapo', 'consigliere', 'capo', 'asker'], family_role), xp desc limit 1;
      if succ.id is not null then
        update players set family_role = 'don' where id = succ.id;
        perform family_msg(p.family_id, null, p.nick || ' oyundan ayrıldı. Yeni Don: ' || succ.nick || '.');
      else
        delete from families where id = p.family_id;   -- tek kişilik aile: mekânlar/fabrika sahipsiz kalır
      end if;
    else
      perform family_msg(p.family_id, null, p.nick || ' oyundan ayrıldı.');
    end if;
  end if;

  delete from auth.users where id = p.id;   -- players → ve bağlı bütün kayıtlar
  return done('Hesabın ve bütün oyun verilerin silindi.');
end $$;

insert into api_rpcs values ('delete_my_account(text)') on conflict do nothing;
select apply_grants();
