// Supabase projesi açılınca bu iki değer doldurulacak (Project Settings → API).
// Adrese ?yerel eklenirse (örn. localhost:5180/www/?yerel) yine yerel mod açılır: deneme için.
// Boş kaldığı sürece oyun "yerel mod"da çalışır: aynı SQL kuralları tarayıcı içinde.
// Anon key gizli değildir; güvenlik RLS + RPC fonksiyonlarındadır.
export const SUPABASE_URL = 'https://egabjhoezsnrwoemgrhn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_O7xN8d2KvV3IOsx4v159Wg_klN01wCb';

// Web bildirimleri (Web Push) için açık anahtar. Gizli eşi Supabase Edge Function sırlarında durur, repoda yok.
export const VAPID_PUBLIC_KEY = 'BOEp9gZ65KFwFp--uCZerCQ40it1vYCUgl83fiZ33qVBy1nb21oh2MsPDvlSRjACbAmXkFGmK7W30Ucb1oA8sLA';
