-- Ayrıntılı küfür filtresi + takma ad kuralları.
-- Filtre hilelerini yakalar: "s.i.k.t.i.r", "s i k t i r", "0r0spu", "siiiktir", Türkçe karaktersiz yazım.
-- Masum kelimelere dokunmamak için kelime türleri ayrı tutulur ("sikke", "Işık", "got it" gibi).
--   exact    : normalleştirilmiş kelime tam olarak bu ise (kısa, başka kelimenin içinde geçebilecekler)
--   prefix   : kelime bununla başlıyorsa (Türkçe ekler: siktir-in, orospu-lar...)
--   contains : kelimenin herhangi bir yerinde geçiyorsa (başka bir anlamı olmayan, ayırt edici kökler)

drop function clean_text(text);
drop table banned_words;
create table banned_words (
  word text not null,              -- normalleştirilmiş yazım (küçük harf, Türkçe karaktersiz)
  kind text not null check (kind in ('exact', 'prefix', 'contains')),
  primary key (word, kind)
);
alter table banned_words enable row level security;

insert into banned_words values
  -- Türkçe: tam eşleşme (kısa ya da başka kelimelerin içinde geçebilecekler)
  -- Türkçe karakter düşünce masum kelimeyle aynı yazılanlar BİLEREK yok: sık/sıktı/sıkıcı/sıkış (sik...), am, got, ananın
  ('amk', 'exact'), ('aq', 'exact'), ('mk', 'exact'), ('amq', 'exact'), ('oc', 'exact'), ('pic', 'exact'),
  ('pici', 'exact'), ('picin', 'exact'), ('pice', 'exact'), ('gotu', 'exact'), ('gotun', 'exact'), ('gote', 'exact'),
  ('amini', 'exact'), ('sg', 'exact'), ('sktr', 'exact'), ('pust', 'exact'), ('ibne', 'exact'), ('yarak', 'exact'),
  ('yarrak', 'exact'),
  -- Türkçe: ekli halleriyle
  ('siktir', 'prefix'), ('sikeyim', 'prefix'), ('sikerim', 'prefix'), ('sikik', 'prefix'), ('sikim', 'prefix'),
  ('sikiyim', 'prefix'), ('sikmek', 'prefix'), ('sikecek', 'prefix'), ('sikicem', 'prefix'),
  ('amina', 'prefix'), ('amcik', 'prefix'), ('aminakoy', 'prefix'), ('aminako', 'prefix'), ('amcig', 'prefix'),
  ('orospu', 'prefix'), ('orosbu', 'prefix'), ('orspu', 'prefix'), ('kahpe', 'prefix'), ('pezevenk', 'prefix'),
  ('gavat', 'prefix'), ('kaltak', 'prefix'), ('surtuk', 'prefix'), ('yavsak', 'prefix'), ('serefsiz', 'prefix'),
  ('ibneler', 'prefix'), ('ibnelik', 'prefix'), ('puste', 'prefix'), ('pustlar', 'prefix'),
  ('gotveren', 'prefix'), ('gotlek', 'prefix'), ('gotos', 'prefix'), ('gotune', 'prefix'), ('gotunu', 'prefix'),
  ('dalyarak', 'prefix'), ('yarragi', 'prefix'), ('yaragi', 'prefix'), ('yarrami', 'prefix'), ('dassak', 'prefix'),
  ('tasak', 'prefix'), ('tassak', 'prefix'), ('picler', 'prefix'), ('piclik', 'prefix'), ('ananisik', 'prefix'),
  ('bacinisik', 'prefix'), ('avradini', 'prefix'), ('godos', 'prefix'), ('kancik', 'prefix'),
  -- Türkçe: her yerde (başka anlamı olmayan kökler)
  ('siktir', 'contains'), ('orospu', 'contains'), ('yarrak', 'contains'), ('amcik', 'contains'), ('pezevenk', 'contains'),
  ('gotveren', 'contains'), ('aminakoy', 'contains'), ('ananisik', 'contains'), ('sikeyim', 'contains'), ('sikerim', 'contains'),
  -- İngilizce
  ('fuck', 'contains'), ('shit', 'prefix'), ('bitch', 'prefix'), ('cunt', 'prefix'), ('nigger', 'contains'),
  ('nigga', 'contains'), ('faggot', 'contains'), ('fag', 'exact'), ('whore', 'prefix'), ('slut', 'prefix'),
  ('dick', 'exact'), ('dickhead', 'prefix'), ('pussy', 'prefix'), ('asshole', 'contains'), ('bastard', 'prefix'),
  ('retard', 'prefix'), ('motherfuck', 'contains'), ('wanker', 'prefix'), ('twat', 'prefix');

-- Karşılaştırma için yazımı tek biçime indir: küçük harf, Türkçe karaktersiz, rakam/sembol harfe, tekrarlar teke
create or replace function norm_word(w text) returns text
language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             translate(lower(translate(w, 'İIı', 'iii')), 'çğöşüâîû013457@$!€', 'cgosuaiuoieastasie'),
             '[^a-z]', '', 'g'),
           '(.)\1+', '\1', 'g')
$$;

-- Tekrarlar teke indiği için listedeki "yarrak", "pezevenk" gibi yazımlar da aynı biçime çevrilerek karşılaştırılır
create or replace function word_banned(w text) returns boolean
language sql stable as $$
  select length(w) > 0 and exists (
    select 1 from banned_words b, lateral (select norm_word(b.word) nb) x
     where (b.kind = 'exact' and w = x.nb)
        or (b.kind = 'prefix' and w like x.nb || '%')
        or (b.kind = 'contains' and position(x.nb in w) > 0))
$$;

-- Sohbet filtresi: yasaklı kelimeleri *** yapar. Boşlukla/noktayla harf harf yazılmış küfürleri de birleştirip yakalar.
create or replace function clean_text(t text) returns text
language plpgsql stable as $$
declare tok text[]; n int; i int; j int; joined text; out_tok text[];
begin
  tok := regexp_split_to_array(trim(t), '\s+');
  n := coalesce(array_length(tok, 1), 0);
  out_tok := tok;
  -- 1) tek tek kelimeler ("s.i.k.t.i.r" tek kelime sayılır, noktalar normalleştirmede düşer)
  for i in 1..n loop
    if word_banned(norm_word(tok[i])) then out_tok[i] := repeat('*', greatest(3, length(tok[i]))); end if;
  end loop;
  -- 2) harf harf boşlukla yazılmışlar ("s i k t i r"): 1-2 harflik ardışık parçaları birleştir
  i := 1;
  while i <= n loop
    if length(norm_word(tok[i])) between 1 and 2 then
      j := i; joined := '';
      while j <= n and length(norm_word(tok[j])) between 1 and 2 loop
        joined := joined || norm_word(tok[j]); j := j + 1;
      end loop;
      if j - i >= 3 and word_banned(norm_word(joined)) then
        for k in i..j - 1 loop out_tok[k] := repeat('*', length(tok[k])); end loop;
      end if;
      i := j;
    else
      i := i + 1;
    end if;
  end loop;
  return array_to_string(out_tok, ' ');
end $$;

-- ─────────────── Takma ad kuralları ───────────────
-- Sadece Türkçe/İngilizce harf (rakam, boşluk, emoji, _ - * vb. yok), 3-16 harf.
-- Benzersizlik büyük/küçük harf ve Türkçe karakter farkını yok sayar (Işık = ISIK = isik): taklit hesapları önler.
create or replace function nick_key(t text) returns text
language sql immutable as $$
  select translate(lower(translate(t, 'İIı', 'iii')), 'çğöşü', 'cgosu')
$$;

alter table players drop constraint players_nick_check;
alter table players add constraint players_nick_check check (nick ~ '^[A-Za-zÇĞİÖŞÜçğıöşü]{3,16}$');
create unique index players_nick_key on players (nick_key(nick));

-- Ad uygun mu? Adın içinde (kelime ayrımı olmadığı için) ayırt edici kökler aranır; kısa kelimeler sadece tam eşleşmede.
create or replace function nick_banned(t text) returns boolean
language sql stable as $$
  select exists (
    select 1 from banned_words b, lateral (select norm_word(b.word) nb) x, lateral (select norm_word(t) nn) y
     where (b.kind = 'exact' and y.nn = x.nb)
        or (b.kind in ('prefix', 'contains') and length(x.nb) >= 4 and position(x.nb in y.nn) > 0))
$$;

alter function create_player(text) rename to create_player_core;
create or replace function create_player(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n text := trim(p_nick);
begin
  if length(n) < 3 or length(n) > 16 then return fail('Takma ad 3 ile 16 harf arasında olmalı.'); end if;
  if n !~ '^[A-Za-zÇĞİÖŞÜçğıöşü]+$' then
    return fail('Takma adda sadece harf kullanabilirsin (Türkçe ya da İngilizce). Rakam, boşluk, emoji ve _ - * gibi işaretler olmaz.');
  end if;
  if nick_banned(n) then return fail('Bu takma ad uygun değil. Hakaret ya da küfür içeren adlar kullanılamaz.'); end if;
  if exists (select 1 from players where nick_key(nick) = nick_key(n)) then return fail('Kullanıcı adı çoktan alınmış.'); end if;
  return create_player_core(n);
end $$;

select apply_grants();
