-- 035: Nöbetteki adamlar, mekân artık ailenin değilse (baskın, aile dağıldı, oyuncu aileden ayrıldı/atıldı, sezon) eve döner.
-- Baskın kodu kendi dönüşünü zaten yapıyor; bu tetikleyiciler diğer bütün yolları kapsar. Tekrar çalıştırılabilir.

-- Mekânın sahibi değişince: yeni sahip ailenin üyesi olmayanların adamları eve
create or replace function release_men_on_spot_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_family is distinct from old.owner_family then
    update player_men m set spot_id = null
     where m.spot_id = new.id
       and not exists (select 1 from players p where p.id = m.player_id and p.family_id = new.owner_family);
  end if;
  return new;
end $$;
drop trigger if exists release_men_spot on spots;
create trigger release_men_spot after update of owner_family on spots
  for each row execute function release_men_on_spot_owner();

-- Oyuncunun ailesi değişince (ayrıldı, atıldı, aile dağıldı): nöbetteki bütün adamları eve
create or replace function release_men_on_family_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.family_id is distinct from old.family_id then
    update player_men set spot_id = null where player_id = new.id and spot_id is not null;
  end if;
  return new;
end $$;
drop trigger if exists release_men_family on players;
create trigger release_men_family after update of family_id on players
  for each row execute function release_men_on_family_change();

-- Şimdiye kadar takılı kalanlar: mekân artık oyuncunun ailesinin değilse eve
update player_men m set spot_id = null
  from spots s, players p
 where m.spot_id = s.id and p.id = m.player_id
   and (s.owner_family is null or p.family_id is distinct from s.owner_family);
