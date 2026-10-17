"use strict";
// Kredi kartları: harcamalar, taksitler, borç ve ileri tarihli ödeme öngörüsü.

const VARSAYILAN_KARTLAR = [
  { id: "axess", ad: "Axess", banka: "Akbank", limit: null, kesim: 7, son_odeme: 17, sabit_ad: "AXESS KART" },
  { id: "world", ad: "Worldcard", banka: "Yapı Kredi", limit: null, kesim: 9, son_odeme: 19, sabit_ad: "WORLDCARD" },
  { id: "bonus", ad: "Bonus", banka: "Garanti BBVA", limit: null, kesim: 7, son_odeme: 17, sabit_ad: "BONUSKART" },
];

const ayAnahtari = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const bugunAyi = () => ayAnahtari(new Date());
function ayEkle(key, n) {
  let [y, m] = key.split("-").map(Number);
  m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
const kisaAy = key => { const [y, m] = key.split("-").map(Number); return `${AY_ADLARI[m - 1].slice(0, 3)} ${String(y).slice(2)}`; };

// Harcamanın ilk taksitinin ödeneceği ay: hesap kesiminden sonraki alışveriş bir sonraki ekstreye girer;
// son ödeme günü kesimden önceyse ödeme bir sonraki aya düşer.
function ilkOdemeAyi(kart, tarih) {
  const d = new Date(tarih);
  let ekstre = ayAnahtari(d);
  if (d.getDate() > kart.kesim) ekstre = ayEkle(ekstre, 1);
  return kart.son_odeme > kart.kesim ? ekstre : ayEkle(ekstre, 1);
}

// Her işlem için {ay, tutar, no} taksit listesi; kuruş farkı son taksite eklenir.
function taksitler(islem) {
  const kart = kartBul(islem.kart_id);
  if (!kart) return [];
  const n = Math.max(1, islem.taksit || 1);
  const birim = Math.floor(islem.tutar / n * 100) / 100;
  const ilk = ilkOdemeAyi(kart, islem.tarih);
  return Array.from({ length: n }, (_, i) => ({
    ay: ayEkle(ilk, i), no: i + 1, n,
    tutar: i === n - 1 ? Math.round((islem.tutar - birim * (n - 1)) * 100) / 100 : birim,
  }));
}

function kartBul(id) { return state.kartlar.find(k => k.id === id); }

// Belirli ayda kart başına ödenecek tutar
function aylikOdeme(kartId, ay) {
  let t = 0;
  for (const i of state.kart_islemleri) {
    if (kartId && i.kart_id !== kartId) continue;
    for (const tk of taksitler(i)) if (tk.ay === ay) t += tk.tutar;
  }
  return t;
}

// Bu aydan itibaren ödenmemiş taksitlerin toplamı (kartın kalan borcu)
function kalanBorc(kartId, baslangic = bugunAyi()) {
  let t = 0;
  for (const i of state.kart_islemleri) {
    if (kartId && i.kart_id !== kartId) continue;
    for (const tk of taksitler(i)) if (tk.ay >= baslangic) t += tk.tutar;
  }
  return t + (kartId ? (kartBul(kartId).ek_borc || 0) : state.kartlar.reduce((a, k) => a + (k.ek_borc || 0), 0));
}

function kartOzetSatiri() {
  const ay = bugunAyi();
  return { buAy: aylikOdeme(null, ay), toplamBorc: kalanBorc(null) };
}

let kartFormAcik = false;

function viewKartlar() {
  const ay = bugunAyi();
  const ufuk = Array.from({ length: 12 }, (_, i) => ayEkle(ay, i));
  const tablo = ufuk.map(a => ({ a, kartlar: state.kartlar.map(k => aylikOdeme(k.id, a)), toplam: aylikOdeme(null, a) }));
  const enBuyuk = Math.max(1, ...tablo.map(r => r.toplam));
  const o = kartOzetSatiri();
  const bugun = new Date().toISOString().slice(0, 10);

  const islemler = state.kart_islemleri.slice().sort((a, b) => b.tarih.localeCompare(a.tarih));

  return `
    <div class="grid">
      ${stat("Bu ay ödenecek", money(o.buAy), "", monthLabel(ay))}
      ${stat("Gelecek ay", money(aylikOdeme(null, ayEkle(ay, 1))), "", monthLabel(ayEkle(ay, 1)))}
      ${stat("Toplam kart borcu", money(o.toplamBorc), o.toplamBorc > 0 ? "neg" : "", "Kalan taksitler + ek borç")}
    </div>

    <h2>Kartlarım</h2>
    <div class="grid cards">
      ${state.kartlar.map(k => {
        const borc = kalanBorc(k.id), buAy = aylikOdeme(k.id, ay);
        return `<div class="card">
          <div class="row" style="padding-top:0"><div><div class="name">${esc(k.ad)}</div><div class="meta">${esc(k.banka)} · kesim ${k.kesim}, son ödeme ${k.son_odeme}</div></div>
            <button class="btn small ghost" data-kart-duzenle="${k.id}">Düzenle</button></div>
          <div class="row"><span class="muted">Bu ay</span><span class="amt">${money(buAy)}</span></div>
          <div class="row"><span class="muted">Kalan borç</span><span class="amt">${money(borc)}</span></div>
          ${k.limit ? `<div class="meta">Limit ${money(k.limit)} · kullanılabilir ${money(k.limit - borc)}</div>
            <div class="bar ${borc > k.limit ? "over" : ""}"><span style="width:${pct(borc, k.limit)}%"></span></div>` : ""}
        </div>`;
      }).join("")}
    </div>
    <div class="actions"><button class="btn small ghost" data-kart-ekle>+ Kart ekle</button></div>

    <h2>Taksit öngörüsü (12 ay)</h2>
    <div class="card scroll-x"><table class="week-table forecast">
      <tr><th>Ay</th>${state.kartlar.map(k => `<th>${esc(k.ad)}</th>`).join("")}<th>Toplam</th><th class="barcol"></th></tr>
      ${tablo.map(r => `<tr><td>${kisaAy(r.a)}</td>${r.kartlar.map(v => `<td>${v ? tl.format(v) : "—"}</td>`).join("")}
        <td><b>${tl.format(r.toplam)}</b></td><td class="barcol"><div class="bar"><span style="width:${pct(r.toplam, enBuyuk)}%"></span></div></td></tr>`).join("")}
    </table></div>
    ${state.aylar[current] ? `<div class="actions"><button class="btn small" data-plana-aktar>${monthLabel(current)} planına aktar</button>
      <span class="note">Kartların bu ayki ödemesini Sabit giderler'deki kart kalemlerine planlanan olarak yazar.</span></div>` : ""}

    <h2>Kart harcaması ekle</h2>
    <div class="card">
      <form id="kartIslemForm" class="form-grid">
        <label>Kart<select name="kart_id">${state.kartlar.map(k => `<option value="${k.id}">${esc(k.ad)}</option>`).join("")}</select></label>
        <label>Tarih<input name="tarih" type="date" value="${bugun}" required></label>
        <label class="wide">Açıklama<input name="aciklama" type="text" placeholder="Örn. Buzdolabı" required></label>
        <label>Tutar (₺)<input name="tutar" type="text" inputmode="decimal" required></label>
        <label>Taksit<select name="taksit">${[1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 18, 24].map(n => `<option value="${n}">${n === 1 ? "Peşin" : n + " taksit"}</option>`).join("")}</select></label>
        <div class="wide"><button class="btn" type="submit">Ekle</button></div>
      </form>
    </div>

    <h2>Kart harcamaları</h2>
    <div class="card list">
      ${islemler.length ? islemler.map(i => {
        const tk = taksitler(i), kalan = tk.filter(t => t.ay >= ay);
        const k = kartBul(i.kart_id);
        const sira = tk.filter(t => t.ay <= ay).length;
        const etiket = i.taksit > 1 ? (sira ? `${sira}/${i.taksit} taksit` : `ilk taksit ${kisaAy(tk[0].ay)}`) : "";
        return `<div class="row"><div><div class="name">${esc(i.aciklama)}${etiket ? `<span class="chip">${etiket}</span>` : ""}</div>
          <div class="meta">${esc(k?.ad || "?")} · ${new Date(i.tarih).toLocaleDateString("tr-TR")}${i.kategori ? " · " + esc(i.kategori) : ""}${kalan.length && i.taksit > 1 ? ` · kalan ${money(kalan.reduce((a, t) => a + t.tutar, 0))}` : ""}</div></div>
          <div class="amt">${money(i.tutar)} <button class="del" data-kart-sil="${i.id}" aria-label="Sil">×</button></div></div>`;
      }).join("") : `<div class="row"><div class="muted">Henüz kart harcaması yok. Yukarıdan ekleyebilir ya da Harcamalar'dan fiş tarayabilirsin.</div></div>`}
    </div>`;
}

function kartIslemiEkle(v) {
  state.kart_islemleri.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kart_id: v.kart_id, tarih: v.tarih, aciklama: v.aciklama, tutar: v.tutar,
    taksit: Number(v.taksit) || 1, kategori: v.kategori || null, fis_id: v.fis_id || null,
  });
}

function kartDuzenle(id) {
  const yeni = !id;
  const k = yeni ? { id: "k" + Date.now().toString(36), ad: "", banka: "", limit: null, kesim: 1, son_odeme: 11, sabit_ad: "", ek_borc: 0 } : kartBul(id);
  openForm(yeni ? "Kart ekle" : `${k.ad} kartı`, [
    { name: "ad", label: "Kart adı", value: k.ad, required: true },
    { name: "banka", label: "Banka", value: k.banka },
    { name: "kesim", label: "Hesap kesim günü", type: "number", value: k.kesim, min: 1, max: 31 },
    { name: "son_odeme", label: "Son ödeme günü", type: "number", value: k.son_odeme, min: 1, max: 31 },
    { name: "limit", label: "Kart limiti (₺)", value: k.limit ?? "", money: true },
    { name: "ek_borc", label: "Uygulama dışındaki kalan borç (₺)", value: k.ek_borc || "", money: true,
      hint: "Uygulamaya girmediğin eski taksitlerin toplamı." },
  ], v => {
    Object.assign(k, {
      ad: v.ad.trim(), banka: v.banka.trim(), kesim: Number(v.kesim) || 1, son_odeme: Number(v.son_odeme) || 1,
      limit: parseTRNumber(v.limit) || null, ek_borc: parseTRNumber(v.ek_borc) || 0,
    });
    if (yeni) { k.sabit_ad = k.ad.toLocaleUpperCase("tr-TR"); state.kartlar.push(k); }
    save(); render();
  }, yeni ? null : () => {
    if (state.kart_islemleri.some(i => i.kart_id === k.id)) return toast("Bu kartta harcama var; önce onları sil.");
    state.kartlar.splice(state.kartlar.indexOf(k), 1); save(); render();
  });
}

document.getElementById("view").addEventListener("click", e => {
  const t = e.target.closest("[data-kart-duzenle],[data-kart-ekle],[data-kart-sil],[data-plana-aktar]");
  if (!t) return;
  e.preventDefault();
  if ("kartDuzenle" in t.dataset) kartDuzenle(t.dataset.kartDuzenle);
  else if ("kartEkle" in t.dataset) kartDuzenle(null);
  else if (t.dataset.kartSil) {
    const i = state.kart_islemleri.findIndex(x => x.id === t.dataset.kartSil);
    if (i < 0 || !confirm(`"${state.kart_islemleri[i].aciklama}" silinsin mi?`)) return;
    state.kart_islemleri.splice(i, 1);
  } else if ("planaAktar" in t.dataset) {
    // Sadece taksit öngörüsü olan kartlar yazılır; mevcut plan değeri değişecekse önce sorulur.
    const ay = month();
    const degisim = [];
    for (const k of state.kartlar) {
      const tutar = Math.round(aylikOdeme(k.id, current));
      if (!tutar) continue;
      const kalem = ay.sabit_giderler.find(x => x.ad.toLocaleUpperCase("tr-TR") === (k.sabit_ad || "").toLocaleUpperCase("tr-TR"));
      if (kalem && kalem.planlanan === tutar) continue;
      degisim.push({ k, kalem, tutar });
    }
    if (!degisim.length) return toast("Plana yazılacak yeni bir kart tutarı yok.");
    const ozet = degisim.map(d => `${d.k.ad}: ${d.kalem ? money(d.kalem.planlanan) : "yeni kalem"} → ${money(d.tutar)}`).join("\n");
    if (!confirm(`${monthLabel(current)} planı güncellensin mi?\n\n${ozet}`)) return;
    for (const d of degisim) {
      if (d.kalem) d.kalem.planlanan = d.tutar;
      else ay.sabit_giderler.unshift({ ad: d.k.sabit_ad || d.k.ad, kategori: "kredi_karti", planlanan: d.tutar, gerceklesen: 0, odeme_gunu: d.k.son_odeme });
    }
    toast(`${degisim.length} kart kalemi ${monthLabel(current)} planına yazıldı.`);
  }
  save(); render();
});

document.getElementById("view").addEventListener("submit", e => {
  if (e.target.id !== "kartIslemForm") return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target));
  v.tutar = parseTRNumber(v.tutar);
  if (!(v.tutar > 0)) return toast("Geçerli bir tutar gir.");
  kartIslemiEkle(v);
  save(); render();
  toast(v.taksit > 1 ? `${v.taksit} taksit eklendi: ayda ${money(v.tutar / v.taksit)}` : "Harcama eklendi.");
});
