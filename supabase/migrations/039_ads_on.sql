-- 039: Ödüllü reklamla hızlandırma açılır (mağaza uygulamasında AdMob; web sürümünde düğme "telefon uygulamasında" der).
-- Günde ad_boosts_daily (8) hak. Ödül şimdilik istemcinin "reklam izlendi" bildirimine güvenir;
-- sunucu taraflı doğrulama (AdMob SSV → Edge Function) sonraki adım. Tekrar çalıştırılabilir.
update game_settings set value = 1 where key = 'ads_enabled';
