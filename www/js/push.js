// Web bildirimleri (Web Push). Oyun kapalıyken de "işin hazır", "mesaj geldi", "saldırıya uğradın" gibi haberler gelir.
// Android/masaüstü tarayıcılarda doğrudan çalışır; iPhone'da oyun Ana Ekrana eklenmiş olmalı (iOS 16.4+).
// Telefon mağazası sürümünde (Capacitor) yerel bildirim altyapısına geçilecek; sunucu tarafı aynı kalır.
import { VAPID_PUBLIC_KEY } from './config.js';

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('sw.js'); } catch { return null; }
}

export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { supported: false, reason: isIOS && !standalone
      ? "iPhone'da bildirim almak için oyunu Ana Ekrana ekle: Safari'de Paylaş → Ana Ekrana Ekle, sonra oyunu oradan aç."
      : 'Bu tarayıcı bildirimleri desteklemiyor.' };
  }
  if (!VAPID_PUBLIC_KEY) return { supported: false, reason: 'Bildirimler henüz ayarlanmadı.' };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return { supported: true, on: !!sub && Notification.permission === 'granted', denied: Notification.permission === 'denied' };
}

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const enc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function enablePush(api) {
  const st = await pushState();
  if (!st.supported) return { ok: false, msg: st.reason };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, msg: 'Bildirim izni verilmedi.' };
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSW());
  if (!reg) return { ok: false, msg: 'Bildirim servisi başlatılamadı.' };
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) }));
  const r = await api.rpc('save_push_sub', { p_endpoint: sub.endpoint, p_p256dh: enc(sub.getKey('p256dh')), p_auth: enc(sub.getKey('auth')) });
  return r.ok === false ? r : { ok: true, msg: 'Bildirimler açıldı. Oyun kapalıyken de haber vereceğiz.' };
}

export async function disablePush(api) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.rpc('delete_push_sub', { p_endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
