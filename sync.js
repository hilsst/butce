"use strict";
// Firebase ile cihazlar arası senkronizasyon.
// Veri, kullanıcının kendi Firestore alanında bölümler halinde tutulur:
//   kullanicilar/{uid}/bolumler/{ay_2026-10 | kartlar | kart_islemleri | harcamalar | banka}
// Her kayıtta yalnızca değişen bölümler gönderilir; diğer cihazdaki değişiklik anında gelir.
// Firestore'un yerel önbelleği sayesinde internetsizken yapılan değişiklikler bağlantı gelince gönderilir.

const senkron = { durum: "kapali", kullanici: null, db: null, son: {}, ilkGeldi: false, zamanlayici: null, bekleyenRender: false };

function bolumler(s) {
  const b = {
    kartlar: s.kartlar, kart_islemleri: s.kart_islemleri,
    harcamalar: s.harcamalar, banka: s.banka_kayitlari,
  };
  for (const [k, v] of Object.entries(s.aylar)) b["ay_" + k] = v;
  return b;
}

function bolumUygula(id, veri) {
  if (id.startsWith("ay_")) state.aylar[id.slice(3)] = veri;
  else if (id === "banka") state.banka_kayitlari = veri;
  else state[id] = veri;
}

function koleksiyon() {
  return senkron.db.collection("kullanicilar").doc(senkron.kullanici.uid).collection("bolumler");
}

function gonder() {
  if (senkron.durum !== "acik" || !senkron.ilkGeldi) return;
  const batch = senkron.db.batch();
  let n = 0;
  for (const [id, veri] of Object.entries(bolumler(state))) {
    const json = JSON.stringify(veri ?? null);
    if (senkron.son[id] === json) continue;
    senkron.son[id] = json;
    batch.set(koleksiyon().doc(id), { json, guncelleme: firebase.firestore.FieldValue.serverTimestamp() });
    n++;
  }
  if (n) batch.commit().catch(err => { toast("Senkronizasyon hatası: " + err.message); });
}

window.senkronKaydet = () => {
  clearTimeout(senkron.zamanlayici);
  senkron.zamanlayici = setTimeout(gonder, 700);
};

// Kullanıcı bir alana yazarken ekranı yenilemeyelim; alan bırakılınca yenilenir.
function guvenliRender() {
  const a = document.activeElement;
  if (a && a.closest?.("#view") && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) {
    senkron.bekleyenRender = true;
    return;
  }
  if (!state.aylar[current]) current = latestMonth();
  render();
}
document.addEventListener("focusout", () => {
  if (senkron.bekleyenRender) { senkron.bekleyenRender = false; setTimeout(guvenliRender, 0); }
});

function dinle() {
  senkron.ilkGeldi = false;
  return koleksiyon().onSnapshot({ includeMetadataChanges: true }, snap => {
    let degisti = false;
    // Önbellekten gelen boş ilk sonuç "bulutta veri yok" demek değildir; sunucuyu bekle.
    if (!senkron.ilkGeldi && snap.metadata.fromCache && snap.size === 0) return;
    if (!senkron.ilkGeldi) {
      // İlk eşitleme: sunucudaki bölümler esas alınır, yalnızca bu cihazda olanlar sunucuya gönderilir.
      senkron.ilkGeldi = true;
      snap.forEach(d => {
        senkron.son[d.id] = d.data().json;
        bolumUygula(d.id, JSON.parse(d.data().json));
        degisti = true;
      });
      save({ yerel: true });
      gonder();
      if (snap.size) toast("Veriler buluttan eşitlendi.");
    } else {
      snap.docChanges().forEach(c => {
        if (c.doc.metadata.hasPendingWrites || c.type === "removed") return;
        const json = c.doc.data().json;
        if (senkron.son[c.doc.id] === json) return;
        senkron.son[c.doc.id] = json;
        bolumUygula(c.doc.id, JSON.parse(json));
        degisti = true;
      });
      if (degisti) save({ yerel: true });
    }
    if (degisti) guvenliRender();
    senkronKutusu();
  }, err => {
    senkron.durum = "hata";
    toast("Senkronizasyon durdu: " + err.message);
    senkronKutusu();
  });
}

function scriptYukle(src) {
  return new Promise((ok, hata) => {
    const s = Object.assign(document.createElement("script"), { src, onload: ok, onerror: () => hata(new Error(src + " yüklenemedi")) });
    document.head.appendChild(s);
  });
}

async function senkronBaslat() {
  if (!window.FIREBASE_CONFIG) { senkronKutusu(); return; }
  try {
    for (const f of ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"]) await scriptYukle("firebase/" + f);
    firebase.initializeApp(window.FIREBASE_CONFIG);
    senkron.db = firebase.firestore();
    if (window.FIREBASE_EMULATOR) { // yalnızca yerel testlerde
      firebase.auth().useEmulator("http://127.0.0.1:9099");
      senkron.db.useEmulator("127.0.0.1", 8085);
    }
    await senkron.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    let iptal = null;
    firebase.auth().onAuthStateChanged(u => {
      iptal?.(); iptal = null;
      senkron.kullanici = u;
      senkron.son = {};
      senkron.durum = u ? "acik" : "girisYok";
      if (u) iptal = dinle();
      senkronKutusu();
    });
  } catch (err) {
    senkron.durum = "hata";
    senkronKutusu();
  }
}

async function girisYap() {
  const saglayici = new firebase.auth.GoogleAuthProvider();
  const tekBasina = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  try {
    if (tekBasina && /iPhone|iPad/.test(navigator.userAgent)) await firebase.auth().signInWithRedirect(saglayici);
    else await firebase.auth().signInWithPopup(saglayici);
  } catch (err) {
    if (/popup/.test(err.code || "")) await firebase.auth().signInWithRedirect(saglayici);
    else toast("Giriş yapılamadı: " + err.message);
  }
}

window.senkronGirisButonu = () =>
  senkron.durum === "girisYok" ? `<button class="btn" data-senkron-giris>Google ile giriş yap</button>` : "";

function senkronKutusu() {
  const kutu = document.getElementById("syncBox");
  const nokta = document.getElementById("syncDot");
  const metin = {
    kapali: ["Senkronizasyon kapalı", "Firebase ayarı yapılmadı; veriler yalnızca bu cihazda."],
    girisYok: ["Senkronizasyon hazır", "Telefon ve bilgisayarı eşitlemek için Google hesabınla giriş yap."],
    acik: ["Eşitleniyor", senkron.kullanici?.email || ""],
    hata: ["Senkronizasyon hatası", "Bağlantını kontrol et ya da çıkış yapıp yeniden gir."],
  }[senkron.durum];
  kutu.innerHTML = `<div><div class="name">${metin[0]}</div><div class="note">${esc(metin[1])}</div></div>
    ${senkron.durum === "girisYok" ? `<button class="btn" data-senkron-giris>Google ile giriş yap</button>` : ""}
    ${senkron.durum === "acik" || senkron.durum === "hata" ? `<button class="btn ghost small" data-senkron-cikis>Çıkış yap</button>` : ""}`;
  nokta.classList.toggle("hidden", senkron.durum === "kapali");
  nokta.classList.toggle("off", senkron.durum !== "acik");
  if (!months().length) render();
}

document.addEventListener("click", e => {
  if (e.target.closest("[data-senkron-giris]")) girisYap();
  if (e.target.closest("[data-senkron-cikis]") && confirm("Çıkış yapılsın mı? Bu cihazdaki veriler silinmez.")) firebase.auth().signOut();
});

senkronBaslat();
