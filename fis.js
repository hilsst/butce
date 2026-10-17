"use strict";
// Harcamalar: kamerayla fiş/fatura okuma (cihazda, internetsiz OCR) ve kategori seçimi.

const KATEGORI_IPUCLARI = [
  { ad: /mutfak/i, kw: ["migros", "bim", "a101", "a-101", "şok", "carrefour", "file market", "macrocenter", "metro", "hakmar", "tarım kredi", "kasap", "manav", "fırın", "market", "gıda", "bakkal", "süt", "ekmek", "peynir", "yumurta", "domates"] },
  { ad: /genel/i, kw: ["restoran", "restaurant", "cafe", "kafe", "lokanta", "starbucks", "burger", "döner", "pide", "kebap", "eczane", "kırtasiye", "teknosa", "media markt", "waikiki", "koton", "defacto", "boyner", "ikea", "koçtaş", "bauhaus", "otopark"] },
  { ad: /yakıt/i, kw: ["opet", "shell", "bp", "petrol", "akaryakıt", "motorin", "benzin", "total", "aytemiz", "lpg", "kurşunsuz", "pompa"] },
  { ad: /elektrik/i, kw: ["enerjisa", "elektrik", "aydem", "ck enerji", "edaş", "kwh", "toroslar", "gediz"] },
  { ad: /^su$/i, kw: ["iski", "aski", "izsu", "buski", "su ve kanalizasyon", "m3"] },
  { ad: /internet|kablo/i, kw: ["superonline", "turknet", "türk telekom", "fiber", "internet", "d-smart", "digiturk", "tivibu", "kablo"] },
  { ad: /cep/i, kw: ["turkcell", "vodafone", "gsm", "mobil hat", "tarife"] },
  { ad: /aidat/i, kw: ["aidat", "yönetim", "site yön"] },
  { ad: /araba|bakım/i, kw: ["oto", "servis", "lastik", "yedek parça", "yıkama", "muayene istasyon"] },
  { ad: /kuaför/i, kw: ["kuaför", "kuafor", "berber", "güzellik"] },
  { ad: /akupunktur/i, kw: ["akupunktur", "klinik", "muayene", "sağlık"] },
  { ad: /okul|ders/i, kw: ["okul", "kolej", "dershane", "eğitim", "kurs", "kitap"] },
  { ad: /temizlik/i, kw: ["temizlik", "deterjan"] },
  { ad: /tatil/i, kw: ["otel", "hotel", "tatil", "pegasus", "türk hava", "thy", "turizm"] },
];

const kucuk = s => String(s || "").toLocaleLowerCase("tr-TR");
let fisTaslak = null;
let ocrWorker = null;

// Bütçedeki harcama kalemleri = seçilebilir kategoriler
function kategoriSecenekleri(ay) {
  const s = [
    { id: "hafta:haftalik_mutfak", ad: "Haftalık mutfak" },
    { id: "hafta:haftalik_genel", ad: "Haftalık genel" },
  ];
  ay.sabit_giderler.forEach(x => { if (x.kategori !== "kredi_karti") s.push({ id: "sabit:" + x.ad, ad: x.ad }); });
  ay.kisisel.forEach(x => s.push({ id: "kisisel:" + x.ad, ad: x.ad }));
  return s;
}

function kategoriOner(metin, secenekler) {
  const t = kucuk(metin);
  return secenekler.map(sec => {
    let puan = sec.id === "hafta:haftalik_mutfak" ? 0.5 : sec.id === "hafta:haftalik_genel" ? 0.4 : 0;
    for (const ip of KATEGORI_IPUCLARI) {
      if (!ip.ad.test(sec.ad)) continue;
      for (const k of ip.kw) if (t.includes(k)) puan += 2;
    }
    if (t.includes(kucuk(sec.ad).trim())) puan += 1;
    return { ...sec, puan };
  }).sort((a, b) => b.puan - a.puan);
}

// ---------- Fişten bilgi çıkarma ----------

const TUTAR_RE = /\*?\s*(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*[,.]\s*(\d{2})(?!\d)/g;
function tutarlar(satir) {
  return [...satir.matchAll(TUTAR_RE)].map(m => Number(m[1].replace(/[.\s]/g, "") + "." + m[2]));
}

function fisCozumle(metin) {
  const satirlar = metin.split(/\n+/).map(s => s.trim()).filter(Boolean);
  // Toplam: "TOPLAM", "GENEL TOPLAM", "ÖDENECEK TUTAR" satırlarındaki en büyük tutar
  let toplam = null;
  for (const s of satirlar) {
    const k = kucuk(s);
    if (/kdv|topkdv|ara\s*toplam|para üstü|nakit\s*$/.test(k) && !/genel toplam/.test(k)) continue;
    if (/toplam|top\b|ödenecek|odenecek|tutar|total/.test(k)) {
      const v = tutarlar(s);
      if (v.length) toplam = Math.max(toplam ?? 0, ...v);
    }
  }
  if (toplam == null) {
    const hepsi = satirlar.flatMap(tutarlar).filter(v => v < 1e6);
    toplam = hepsi.length ? Math.max(...hepsi) : null;
  }
  let tarih = null;
  const tm = metin.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (tm) {
    const d = new Date(+tm[3], +tm[2] - 1, +tm[1]);
    if (!isNaN(d) && d.getFullYear() > 2000) tarih = `${tm[3]}-${tm[2]}-${tm[1]}`;
  }
  const magaza = (satirlar.find(s => (s.match(/[a-zçğıöşü]/gi) || []).length >= 3) || "").replace(/[^\p{L}\d .&'-]/gu, "").trim().slice(0, 40);
  const fatura = /fatura|son ödeme|abone/i.test(metin);
  return { toplam, tarih, magaza, fatura };
}

// ---------- OCR ----------

async function goruntuHazirla(file) {
  const img = await createImageBitmap(file);
  const olcek = Math.min(1, 1800 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * olcek), height: Math.round(img.height * olcek) });
  const ctx = c.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function ocr(canvas, ilerleme) {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker("tur", 1, {
      workerPath: "ocr/worker.min.js", corePath: "ocr", langPath: "ocr", gzip: true,
      workerBlobURL: false, cacheMethod: "none",
      logger: m => m.status === "recognizing text" && ilerleme(m.progress),
    });
  }
  const { data } = await ocrWorker.recognize(canvas);
  return data.text;
}

async function fisTara(file) {
  const ay = month();
  fisTaslak = { durum: "okunuyor", ilerleme: 0, onizleme: URL.createObjectURL(file), tarih: new Date().toISOString().slice(0, 10),
    magaza: "", tutar: "", odeme: "nakit", taksit: 1, secenekler: kategoriOner("", kategoriSecenekleri(ay)), kategori: null };
  render();
  try {
    const canvas = await goruntuHazirla(file);
    const metin = await ocr(canvas, p => {
      fisTaslak.ilerleme = p;
      const b = document.querySelector("#ocrBar > span"); if (b) b.style.width = Math.round(p * 100) + "%";
    });
    const r = fisCozumle(metin);
    Object.assign(fisTaslak, {
      durum: "hazir", metin,
      magaza: r.magaza, tutar: r.toplam != null ? r.toplam.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "",
      tarih: r.tarih || fisTaslak.tarih, fatura: r.fatura,
      secenekler: kategoriOner(metin, kategoriSecenekleri(ay)),
    });
    fisTaslak.kategori = fisTaslak.secenekler[0].id;
  } catch (err) {
    Object.assign(fisTaslak, { durum: "hazir", hata: "Fiş okunamadı, bilgileri elle girebilirsin. (" + err.message + ")" });
    fisTaslak.kategori = fisTaslak.secenekler[0].id;
  }
  render();
}

function elleEkle() {
  const secenekler = kategoriOner("", kategoriSecenekleri(month()));
  fisTaslak = { durum: "hazir", elle: true, tarih: new Date().toISOString().slice(0, 10), magaza: "", tutar: "", odeme: "nakit", taksit: 1, secenekler, kategori: secenekler[0].id };
  render();
}

// ---------- Bütçeye işleme ----------

function haftaIndeksi(gun) { return Math.min(4, Math.floor((gun - 1) / 7)); }

function butceyeIsle(ayKey, katId, tarih, tutar) {
  const ay = state.aylar[ayKey];
  const [tur, ad] = [katId.slice(0, katId.indexOf(":")), katId.slice(katId.indexOf(":") + 1)];
  if (tur === "hafta") {
    const i = haftaIndeksi(new Date(tarih).getDate());
    ay[ad][i].harcanan = (ay[ad][i].harcanan || 0) + tutar;
    return `${ad}.${i}.harcanan`;
  }
  const liste = tur === "sabit" ? ay.sabit_giderler : ay.kisisel;
  const alan = tur === "sabit" ? "gerceklesen" : "harcanan";
  let i = liste.findIndex(x => x.ad === ad);
  if (i < 0) { liste.push(tur === "sabit" ? { ad, kategori: "diger", planlanan: 0, gerceklesen: 0, odeme_gunu: null } : { ad, planlanan: 0, harcanan: 0 }); i = liste.length - 1; }
  liste[i][alan] = (liste[i][alan] || 0) + tutar;
  return `${tur === "sabit" ? "sabit_giderler" : "kisisel"}.${i}.${alan}`;
}

function butcedenGeriAl(h) {
  if (!h.yol || !state.aylar[h.ay]) return;
  const parts = h.yol.split(".");
  let o = state.aylar[h.ay];
  for (const p of parts.slice(0, -1)) { o = o?.[p]; if (!o) return; }
  const k = parts[parts.length - 1];
  o[k] = Math.max(0, (o[k] || 0) - h.tutar);
}

function fisKaydet() {
  const t = fisTaslak;
  const tutar = parseTRNumber(t.tutar);
  if (!(tutar > 0)) return toast("Tutarı kontrol et.");
  if (!t.kategori) return toast("Bir kategori seç.");
  const sec = t.secenekler.find(s => s.id === t.kategori);
  const ayKey = t.tarih.slice(0, 7);
  const hedefAy = state.aylar[ayKey] ? ayKey : current;
  const h = { id: Date.now().toString(36), tarih: t.tarih, magaza: t.magaza || "Harcama", tutar, kategori: sec.ad, kategori_id: sec.id,
    ay: hedefAy, odeme: t.odeme, fatura: !!t.fatura, kaynak: t.elle ? "elle" : "fiş" };
  if (t.odeme === "nakit") {
    h.yol = butceyeIsle(hedefAy, sec.id, t.tarih, tutar);
  } else {
    // Kredi kartı harcaması karta işlenir; bütçeye ay sonunda kart ödemesi olarak yansır.
    kartIslemiEkle({ kart_id: t.odeme, tarih: t.tarih, aciklama: h.magaza, tutar, taksit: t.taksit, kategori: sec.ad, fis_id: h.id });
  }
  state.harcamalar.push(h);
  save();
  fisTaslak = null;
  toast(t.odeme === "nakit" ? `${money(tutar)} → ${sec.ad} (${monthLabel(hedefAy)})` : `${money(tutar)} ${kartBul(t.odeme).ad} kartına işlendi.`);
  if (hedefAy !== ayKey && t.odeme === "nakit") toast(`${t.tarih} ayı bütçede yok; ${monthLabel(hedefAy)} ayına eklendi.`);
  render();
}

// ---------- Görünüm ----------

function fisPaneli() {
  const t = fisTaslak;
  if (t.durum === "okunuyor") {
    return `<div class="card scan">
      <img class="receipt" src="${t.onizleme}" alt="Fiş">
      <div><div class="name">Fiş okunuyor…</div><div class="note">İlk taramada okuma motoru yükleniyor, birkaç saniye sürebilir. Okuma tamamen cihazında yapılır.</div>
      <div class="bar" id="ocrBar"><span style="width:${Math.round(t.ilerleme * 100)}%"></span></div></div></div>`;
  }
  const oneriler = t.secenekler.slice(0, 4), diger = t.secenekler.slice(4);
  const digerSecili = diger.some(s => s.id === t.kategori);
  return `<div class="card scan">
    ${t.onizleme ? `<img class="receipt" src="${t.onizleme}" alt="Fiş">` : ""}
    <div class="scan-form">
      ${t.hata ? `<p class="neg">${esc(t.hata)}</p>` : ""}
      ${t.fatura ? `<span class="chip due">Fatura algılandı</span>` : ""}
      <div class="form-grid">
        <label class="wide">Mağaza / açıklama<input data-fis="magaza" value="${esc(t.magaza)}"></label>
        <label>Tarih<input data-fis="tarih" type="date" value="${t.tarih}"></label>
        <label>Tutar (₺)<input data-fis="tutar" inputmode="decimal" value="${esc(t.tutar)}"></label>
      </div>
      <div class="field-label">Hangi kategori?</div>
      <div class="choices" role="radiogroup">
        ${oneriler.map((s, i) => `<button type="button" role="radio" aria-checked="${s.id === t.kategori}" class="choice ${s.id === t.kategori ? "on" : ""}" data-kat="${esc(s.id)}">${esc(s.ad)}${i === 0 && s.puan >= 2 ? `<small>önerilen</small>` : ""}</button>`).join("")}
        <select data-kat-select class="choice ${digerSecili ? "on" : ""}"><option value="">Diğer…</option>${diger.map(s => `<option value="${esc(s.id)}" ${s.id === t.kategori ? "selected" : ""}>${esc(s.ad)}</option>`).join("")}</select>
      </div>
      <div class="field-label">Nasıl ödendi?</div>
      <div class="choices">
        <button type="button" class="choice ${t.odeme === "nakit" ? "on" : ""}" data-odeme="nakit">Nakit / banka kartı</button>
        ${state.kartlar.map(k => `<button type="button" class="choice ${t.odeme === k.id ? "on" : ""}" data-odeme="${k.id}">${esc(k.ad)}</button>`).join("")}
      </div>
      ${t.odeme !== "nakit" ? `<label class="inline">Taksit <select data-fis="taksit">${[1, 2, 3, 4, 5, 6, 9, 12].map(n => `<option value="${n}" ${n == t.taksit ? "selected" : ""}>${n === 1 ? "Peşin" : n + " taksit"}</option>`).join("")}</select></label>` : ""}
      <div class="actions"><button class="btn" data-fis-kaydet>Harcamayı ekle</button><button class="btn ghost" data-fis-iptal>Vazgeç</button></div>
      ${t.metin ? `<details><summary class="note">Okunan metin</summary><pre class="ocr-text">${esc(t.metin)}</pre></details>` : ""}
    </div></div>`;
}

function viewHarcamalar() {
  const liste = state.harcamalar.filter(h => h.ay === current).sort((a, b) => b.tarih.localeCompare(a.tarih));
  const toplam = liste.reduce((a, h) => a + h.tutar, 0);
  const kategoriler = {};
  liste.forEach(h => kategoriler[h.kategori] = (kategoriler[h.kategori] || 0) + h.tutar);
  return `
    <div class="actions" style="margin-top:0">
      <label class="btn">📷 Fiş / fatura tara<input id="fisKamera" type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn ghost">Galeriden seç<input id="fisGaleri" type="file" accept="image/*" hidden></label>
      <button class="btn ghost" data-elle>Elle ekle</button>
    </div>
    ${fisTaslak ? `<h2>Yeni harcama</h2>${fisPaneli()}` : ""}
    <div class="grid" style="margin-top:16px">${stat(`${monthLabel(current)} harcamaları`, money(toplam), "", `${liste.length} kayıt`)}
      ${Object.entries(kategoriler).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => stat(esc(k), money(v))).join("")}</div>
    <h2>Kayıtlar</h2>
    <div class="card list">${liste.length ? liste.map(h => `<div class="row"><div>
        <div class="name">${esc(h.magaza)}${h.fatura ? `<span class="chip">Fatura</span>` : ""}${h.odeme !== "nakit" ? `<span class="chip">${esc(kartBul(h.odeme)?.ad || "Kart")}</span>` : ""}</div>
        <div class="meta">${new Date(h.tarih).toLocaleDateString("tr-TR")} · ${esc(h.kategori)} · ${h.kaynak}</div></div>
        <div class="amt">${money(h.tutar)} <button class="del" data-harcama-sil="${h.id}" aria-label="Sil">×</button></div></div>`).join("")
      : `<div class="row"><div class="muted">Bu ay için kayıt yok. Fiş tarayarak başlayabilirsin.</div></div>`}</div>
    <p class="note">Nakit ve banka kartı harcamaları seçtiğin bütçe kalemine eklenir. Kredi kartı harcamaları Kartlar'a işlenir ve bütçeye kart ödemesiyle yansır.</p>`;
}

// ---------- Olaylar ----------

const view = document.getElementById("view");
view.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "fisKamera" || el.id === "fisGaleri") {
    e.stopImmediatePropagation();
    if (el.files[0]) fisTara(el.files[0]);
  } else if (el.dataset.fis) {
    e.stopImmediatePropagation();
    fisTaslak[el.dataset.fis] = el.dataset.fis === "taksit" ? Number(el.value) : el.value;
  } else if ("katSelect" in el.dataset) {
    e.stopImmediatePropagation();
    if (el.value) { fisTaslak.kategori = el.value; render(); }
  }
}, true);
view.addEventListener("input", e => { if (e.target.dataset.fis && fisTaslak) fisTaslak[e.target.dataset.fis] = e.target.value; });

view.addEventListener("click", e => {
  const t = e.target.closest("[data-kat],[data-odeme],[data-fis-kaydet],[data-fis-iptal],[data-elle],[data-harcama-sil]");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.kat) { fisTaslak.kategori = t.dataset.kat; render(); }
  else if (t.dataset.odeme) { fisTaslak.odeme = t.dataset.odeme; render(); }
  else if ("fisKaydet" in t.dataset) fisKaydet();
  else if ("fisIptal" in t.dataset) { fisTaslak = null; render(); }
  else if ("elle" in t.dataset) elleEkle();
  else if (t.dataset.harcamaSil) {
    const i = state.harcamalar.findIndex(h => h.id === t.dataset.harcamaSil);
    const h = state.harcamalar[i];
    if (!h || !confirm(`"${h.magaza}" silinsin mi?`)) return;
    butcedenGeriAl(h);
    state.kart_islemleri = state.kart_islemleri.filter(k => k.fis_id !== h.id);
    state.harcamalar.splice(i, 1);
    save(); render();
  }
});
