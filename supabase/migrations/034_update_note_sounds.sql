-- 034: Duyurulara yeni güncelleme notu (sesler, kumarhane, hesap). Önceki notlara dokunmaz. Tekrar çalıştırılabilir.
insert into announcements (kind, title, body, pinned)
select 'guncelleme', 'Güncelleme: sesler, kumarhane ve hesap',
'Bu güncellemeyle gelenler:
• Kumarhane: zar, rulet ve slotta oyun bitince 1 saniye sonra yenisini oynayabilirsin; bekleme uyarısı kalktı.
• Yeni sesler: işte başarı, başarısızlık, yakalanma ve firar; kumarhanede gerçek zar, kart ve fiş sesleri; kazanma ve kaybetme müziği.
• Aile başvurusu, adam tutma ve arkadaşlık isteğinde tok bir tık; limanda alışta ve satışta para sesi; vapurla sefere çıkınca buhar düdüğü.
• Sohbette mesaj gönderince ve açık sohbete mesaj gelince kısa bir tık.
• Hapisteyken, hastanedeyken ya da sığınaktayken kumarhane oyun sesleri çalmaz.
• Ayarlar → Hesap: e-postanı bağla ya da başka cihazdaki karakterine e-postayla gir.
• Müzik artık %5 ile başlar; sesini Ayarlar bölümünden açabilirsin.
• Küçük arayüz düzeltmeleri.
İyi oyunlar!', true
where not exists (select 1 from announcements where title = 'Güncelleme: sesler, kumarhane ve hesap');
