"use strict";

const STORE_KEY = "butce.v1";
const AY_ADLARI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const KATEGORILER = {
  kredi_karti: "Kredi kartı", fatura: "Fatura", ev: "Ev", araba: "Araba",
  kredi: "Kredi", birikim: "Birikim", diger: "Diğer",
};

// ---------- Veri ----------

function loadState() {
  let s = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) s = JSON.parse(raw);
  } catch (e) { /* depolama kapalıysa başlangıç verisiyle devam */ }
  return migrate(s || structuredClone(window.SEED));
}

// Eski kayıtlara yeni bölümleri ekler.
function migrate(s) {
  s.banka_kayitlari ??= [];
  s.kartlar ??= structuredClone(VARSAYILAN_KARTLAR);
  s.kart_islemleri ??= [];
  s.harcamalar ??= [];
  return s;
}

let state = loadState();
let current = localStorage.getItem("butce.ay") || latestMonth();
let tab = "ozet";

function save({ yerel = false } = {}) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast("Kaydedilemedi: tarayıcı depolaması kapalı."); }
  if (!yerel) window.senkronKaydet?.();
}

function months() { return Object.keys(state.aylar).sort(); }
function latestMonth() { const m = months(); return m[m.length - 1]; }
function month() { return state.aylar[current]; }

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return `${AY_ADLARI[m - 1]} ${y}`;
}
function nextKey(key) {
  let [y, m] = key.split("-").map(Number);
  m += 1; if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

const sum = (xs, k) => xs.reduce((a, x) => a + (Number(x[k]) || 0), 0);

function summary(ay) {
  const gelir = sum(ay.gelirler, "tutar") - (ay.cuzdana_cekilen || 0);
  const sabitPlan = sum(ay.sabit_giderler, "planlanan");
  const sabitReel = sum(ay.sabit_giderler, "gerceklesen");
  const kisiselPlan = sum(ay.kisisel, "planlanan");
  const kisiselReel = sum(ay.kisisel, "harcanan");
  const mutfakPlan = sum(ay.haftalik_mutfak, "planlanan");
  const mutfakReel = sum(ay.haftalik_mutfak, "harcanan");
  const genelPlan = sum(ay.haftalik_genel, "planlanan");
  const genelReel = sum(ay.haftalik_genel, "harcanan");
  const planHarcanan = sabitPlan + kisiselPlan + mutfakPlan + genelPlan;
  const reelHarcanan = sabitReel + kisiselReel + mutfakReel + genelReel;
  const mevcut = gelir - reelHarcanan;
  const banka = ay.banka_bakiyesi;
  return {
    gelir, planHarcanan, planKalan: gelir - planHarcanan, reelHarcanan, mevcut,
    banka, fark: banka == null ? null : banka - mevcut,
    sabitPlan, sabitReel, kisiselPlan, kisiselReel, mutfakPlan, mutfakReel, genelPlan, genelReel,
  };
}

// ---------- Biçimlendirme ----------

const tl = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const money = v => v == null ? "—" : `${tl.format(v)} ₺`;
const signCls = v => v == null ? "" : v < 0 ? "neg" : "pos";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (a, b) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0;

function parseTRNumber(v) {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  let s = String(v).replace(/[^\d,.\-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 36.000 → 36000
  return parseFloat(s);
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.add("hidden"), 2800);
}

// ---------- Ödeme durumu ----------

function dueStatus(item) {
  if (item.planlanan > 0 && item.gerceklesen >= item.planlanan) return { cls: "paid", text: "Ödendi" };
  if (!item.odeme_gunu) return null;
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (key !== current) return { cls: "", text: `Ödeme günü: ${item.odeme_gunu}` };
  const d = item.odeme_gunu - now.getDate();
  if (d < 0) return { cls: "late", text: `${-d} gün gecikti` };
  if (d <= 5) return { cls: "due", text: d === 0 ? "Bugün" : `${d} gün kaldı` };
  return { cls: "", text: `Ödeme günü: ${item.odeme_gunu}` };
}

// ---------- Görünümler ----------

function stat(label, value, cls = "", sub = "") {
  return `<div class="card stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
}
function progress(label, spent, plan) {
  const over = spent > plan;
  return `<div class="row"><div><div class="name">${label}</div><div class="meta">${money(spent)} / ${money(plan)}</div>
    <div class="bar ${over ? "over" : ""}"><span style="width:${pct(spent, plan)}%"></span></div></div>
    <div class="amt ${over ? "neg" : "muted"}">${over ? "+" + money(spent - plan) : money(plan - spent) + " kaldı"}</div></div>`;
}

function viewOzet() {
  const ay = month(), s = summary(ay);
  const upcoming = ay.sabit_giderler
    .map(x => ({ x, st: dueStatus(x) }))
    .filter(({ st }) => st && st.cls !== "paid")
    .sort((a, b) => (a.x.odeme_gunu || 99) - (b.x.odeme_gunu || 99))
    .slice(0, 6);
  return `
    <div class="grid">
      ${stat("Gelir", money(s.gelir))}
      ${stat("Planlanan harcama", money(s.planHarcanan), "", `<div class="plan-kalan">Plan kalan <b class="${signCls(s.planKalan)}">${money(s.planKalan)}</b></div>`)}
      ${stat("Gerçekleşen harcama", money(s.reelHarcanan), "", `Planın %${pct(s.reelHarcanan, s.planHarcanan)}'i`)}
      ${stat("Olması gereken (mevcut)", money(s.mevcut), signCls(s.mevcut))}
      ${stat("Banka bakiyesi", money(s.banka), "", s.banka == null ? `<a href="#" data-goto="banka">Bakiye gir</a>` : "Garanti BBVA")}
      ${stat("Fark", s.fark == null ? "—" : money(s.fark), signCls(s.fark), "Banka − mevcut")}
      ${(k => stat("Kredi kartı borcu", money(k.toplamBorc), "", `<a href="#" data-goto="kartlar">Bu ay ödenecek ${money(k.buAy)}</a>`))(kartOzetSatiri())}
    </div>
    <div class="two">
      <div><h2>Plan ve gerçekleşen</h2><div class="card list">
        ${progress("Sabit giderler", s.sabitReel, s.sabitPlan)}
        ${progress("Haftalık mutfak", s.mutfakReel, s.mutfakPlan)}
        ${progress("Haftalık genel", s.genelReel, s.genelPlan)}
        ${progress("Kişisel harcamalar", s.kisiselReel, s.kisiselPlan)}
      </div></div>
      <div><h2>Ödenmemiş sabit giderler</h2><div class="card list">
        ${upcoming.length ? upcoming.map(({ x, st }) => `<div class="row"><div><div class="name">${esc(x.ad)}<span class="chip ${st.cls}">${st.text}</span></div>
          <div class="meta">${KATEGORILER[x.kategori] || ""}</div></div><div class="amt">${money(x.planlanan - x.gerceklesen)}</div></div>`).join("")
          : `<div class="row"><div class="muted">Bu ayın tüm sabit giderleri ödenmiş.</div></div>`}
      </div></div>
    </div>
    <h2>Son aylar</h2>
    <div class="card scroll-x"><table class="week-table">
      <tr><th>Ay</th><th>Gelir</th><th>Plan</th><th>Gerçekleşen</th><th>Mevcut</th><th>Fark</th></tr>
      ${months().slice(-6).reverse().map(k => { const t = summary(state.aylar[k]); return `<tr><td>${monthLabel(k)}</td><td>${tl.format(t.gelir)}</td><td>${tl.format(t.planHarcanan)}</td><td>${tl.format(t.reelHarcanan)}</td><td>${tl.format(t.mevcut)}</td><td class="${signCls(t.fark)}">${t.fark == null ? "—" : tl.format(t.fark)}</td></tr>`; }).join("")}
    </table></div>`;
}

function numInput(path, value) {
  return `<input type="number" inputmode="decimal" data-path="${path}" value="${value || ""}" placeholder="0">`;
}
function textInput(path, value) {
  return `<input type="text" data-path="${path}" value="${esc(value)}">`;
}

function viewSabit() {
  const ay = month(), s = summary(ay);
  return `
    <div class="grid">${stat("Planlanan", money(s.sabitPlan))}${stat("Ödenen", money(s.sabitReel))}${stat("Kalan", money(s.sabitPlan - s.sabitReel), signCls(s.sabitPlan - s.sabitReel))}</div>
    <h2>Sabit giderler</h2>
    <div class="card">
      <div class="edit-row sabit-row head"><span class="name-cell">Kalem</span><span>Planlanan</span><span>Ödenen</span><span>Gün</span><span></span></div>
      ${ay.sabit_giderler.map((x, i) => {
        const st = dueStatus(x);
        return `<div class="edit-row sabit-row">
          <div class="name-cell">${textInput(`sabit_giderler.${i}.ad`, x.ad)}
            <div class="meta"><select data-path="sabit_giderler.${i}.kategori">${Object.entries(KATEGORILER).map(([k, v]) => `<option value="${k}" ${k === x.kategori ? "selected" : ""}>${v}</option>`).join("")}</select>
            ${st ? `<span class="chip ${st.cls}">${st.text}</span>` : ""}
            ${st?.cls !== "paid" && x.planlanan > 0 ? `<button class="btn small ghost" data-pay="${i}">Ödendi</button>` : ""}</div></div>
          ${numInput(`sabit_giderler.${i}.planlanan`, x.planlanan)}
          ${numInput(`sabit_giderler.${i}.gerceklesen`, x.gerceklesen)}
          <input type="number" inputmode="numeric" min="1" max="31" data-path="sabit_giderler.${i}.odeme_gunu" value="${x.odeme_gunu || ""}">
          <button class="del" data-del="sabit_giderler.${i}" aria-label="Sil">×</button>
        </div>`;
      }).join("")}
      <div class="actions"><button class="btn small ghost" data-add="sabit_giderler">+ Kalem ekle</button></div>
    </div>`;
}

function weekTable(key, title) {
  const rows = month()[key];
  const p = sum(rows, "planlanan"), h = sum(rows, "harcanan");
  return `<h2>${title}</h2><div class="card scroll-x"><table class="week-table">
    <tr><th></th>${rows.map(r => `<th>${r.hafta}</th>`).join("")}<th>Toplam</th></tr>
    <tr><td>Planlanan</td>${rows.map((r, i) => `<td>${numInput(`${key}.${i}.planlanan`, r.planlanan)}</td>`).join("")}<td>${tl.format(p)}</td></tr>
    <tr><td>Harcanan</td>${rows.map((r, i) => `<td>${numInput(`${key}.${i}.harcanan`, r.harcanan)}</td>`).join("")}<td>${tl.format(h)}</td></tr>
    <tr><td>Kalan</td>${rows.map(r => `<td class="${signCls(r.planlanan - r.harcanan)}">${tl.format(r.planlanan - r.harcanan)}</td>`).join("")}<td class="${signCls(p - h)}">${tl.format(p - h)}</td></tr>
  </table></div>`;
}

function viewHaftalik() {
  return weekTable("haftalik_mutfak", "Haftalık mutfak") + weekTable("haftalik_genel", "Haftalık genel masraf");
}

function simpleList(key, title, amountKeys, labels) {
  const rows = month()[key];
  return `<h2>${title}</h2><div class="card">
    <div class="edit-row head"><span>Kalem</span>${labels.map(l => `<span>${l}</span>`).join("")}${labels.length < 2 ? "<span></span>" : ""}<span></span></div>
    ${rows.map((x, i) => `<div class="edit-row">${textInput(`${key}.${i}.ad`, x.ad)}
      ${amountKeys.map(k => numInput(`${key}.${i}.${k}`, x[k])).join("")}${amountKeys.length < 2 ? "<span></span>" : ""}
      <button class="del" data-del="${key}.${i}" aria-label="Sil">×</button></div>`).join("")}
    <div class="actions"><button class="btn small ghost" data-add="${key}">+ Kalem ekle</button></div></div>`;
}

function viewKisisel() {
  const s = summary(month());
  return `<div class="grid">${stat("Planlanan", money(s.kisiselPlan))}${stat("Harcanan", money(s.kisiselReel))}${stat("Kalan", money(s.kisiselPlan - s.kisiselReel), signCls(s.kisiselPlan - s.kisiselReel))}</div>
    ${simpleList("kisisel", "Kişisel harcamalar", ["planlanan", "harcanan"], ["Planlanan", "Harcanan"])}
    <p class="note">Haftalık genel masraf "Haftalık" sekmesinde tutulur ve toplamlara ayrıca eklenir.</p>`;
}

function viewGelir() {
  const ay = month(), s = summary(ay);
  return `<div class="grid">${stat("Net gelir", money(s.gelir))}</div>
    ${simpleList("gelirler", "Gelirler", ["tutar"], ["Tutar"])}
    <div class="card"><div class="field"><label for="cuzdan">Cüzdana çekilen nakit (gelirden düşülür)</label>
      <input id="cuzdan" type="number" inputmode="decimal" data-path="cuzdana_cekilen" value="${ay.cuzdana_cekilen || ""}" placeholder="0"></div></div>`;
}

function viewBanka() {
  const ay = month(), s = summary(ay);
  const kayitlar = (state.banka_kayitlari || []).slice(-8).reverse();
  return `
    <div class="grid">${stat("Banka bakiyesi", money(s.banka))}${stat("Olması gereken", money(s.mevcut))}${stat("Fark", s.fark == null ? "—" : money(s.fark), signCls(s.fark))}</div>
    <div class="two">
      <div><h2>Garanti hesap hareketlerini içe aktar</h2><div class="card">
        <p class="note">Garanti BBVA Internet veya Mobil'de Hesaplarım → Hesap Hareketleri → Excel olarak indir. Dosyayı buraya seç; son bakiye otomatik okunur.</p>
        <label class="btn">Excel / CSV seç<input id="bankFile" type="file" accept=".xlsx,.xls,.csv" hidden></label>
        <div id="bankPreview"></div>
      </div></div>
      <div><h2>Bakiyeyi elle gir</h2><div class="card">
        <div class="field"><label for="manualBalance">Hesapta kalan tutar</label>
          <input id="manualBalance" type="text" inputmode="decimal" placeholder="Örn. 136.890" value="${ay.banka_bakiyesi ?? ""}"></div>
        <button id="saveBalance" class="btn">Kaydet</button>
      </div></div>
    </div>
    <h2>Bakiye geçmişi</h2>
    <div class="card list">${kayitlar.length ? kayitlar.map(k => `<div class="row"><div><div class="name">${money(k.bakiye)}</div>
      <div class="meta">${new Date(k.zaman).toLocaleString("tr-TR")} · ${esc(k.kaynak)}</div></div><div class="amt muted">${monthLabel(k.ay)}</div></div>`).join("")
      : `<div class="row"><div class="muted">Henüz kayıt yok.</div></div>`}</div>`;
}

const VIEWS = { ozet: viewOzet, harcamalar: viewHarcamalar, kartlar: viewKartlar, sabit: viewSabit, haftalik: viewHaftalik, kisisel: viewKisisel, gelir: viewGelir, banka: viewBanka };

// Veri yoksa (yayındaki sürüm kişisel veri içermez) ilk açılışta yedekten yükleme ekranı gösterilir.
function viewHosgeldin() {
  return `<div class="card" style="max-width:520px;margin:40px auto;text-align:center">
    <img src="icon.svg" alt="" style="width:64px;height:64px">
    <h2>Bütçene hoş geldin</h2>
    <p class="muted">Başlamak için yedek dosyanı (butce-baslangic.json) yükle. Senkronizasyon açıksa Google hesabınla girerek diğer cihazındaki verileri de getirebilirsin.</p>
    <div class="actions" style="justify-content:center">
      <label class="btn">Yedek dosyasını yükle<input type="file" accept="application/json" hidden data-ilk-yukle></label>
      ${window.senkronGirisButonu?.() || ""}
      <button class="btn ghost" data-bos-basla>Boş başla</button>
    </div></div>`;
}

function render() {
  if (!months().length) {
    document.getElementById("tabs").classList.add("hidden");
    document.querySelector(".month-nav").classList.add("hidden");
    document.getElementById("view").innerHTML = viewHosgeldin();
    return;
  }
  document.getElementById("tabs").classList.remove("hidden");
  document.querySelector(".month-nav").classList.remove("hidden");
  const sel = document.getElementById("monthSelect");
  sel.innerHTML = months().map(k => `<option value="${k}" ${k === current ? "selected" : ""}>${monthLabel(k)}</option>`).join("");
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("view").innerHTML = VIEWS[tab]();
}

// ---------- Form penceresi ----------

// fields: [{name, label, type, value, required, min, max, money, hint}]
function openForm(title, fields, onSave, onDelete) {
  const box = document.createElement("div");
  box.className = "sheet";
  box.innerHTML = `<form class="sheet-card"><h3>${esc(title)}</h3>
    ${fields.map(f => `<label class="field"><span>${esc(f.label)}</span>
      <input name="${f.name}" type="${f.type || "text"}" ${f.money ? 'inputmode="decimal"' : ""} value="${esc(f.value ?? "")}"
        ${f.required ? "required" : ""} ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""}>
      ${f.hint ? `<small class="note">${esc(f.hint)}</small>` : ""}</label>`).join("")}
    <div class="actions"><button class="btn" type="submit">Kaydet</button><button class="btn ghost" type="button" data-cancel>Vazgeç</button>
      ${onDelete ? `<button class="btn ghost neg" type="button" data-remove>Sil</button>` : ""}</div></form>`;
  const close = () => box.remove();
  box.addEventListener("click", e => {
    if (e.target === box || e.target.closest("[data-cancel]")) close();
    if (e.target.closest("[data-remove]") && confirm("Silinsin mi?")) { close(); onDelete(); }
  });
  box.querySelector("form").addEventListener("submit", e => {
    e.preventDefault(); onSave(Object.fromEntries(new FormData(e.target))); close();
  });
  document.body.appendChild(box);
  box.querySelector("input")?.focus();
}

// ---------- Düzenleme ----------

function setPath(path, value) {
  const parts = path.split(".");
  let o = month();
  for (const p of parts.slice(0, -1)) o = o[p];
  o[parts[parts.length - 1]] = value;
}

document.getElementById("view").addEventListener("change", e => {
  const el = e.target;
  if (!el.dataset.path) return;
  let v = el.value;
  if (el.type === "number") v = v === "" ? (el.dataset.path.endsWith("odeme_gunu") ? null : 0) : Number(v);
  setPath(el.dataset.path, v);
  save(); render();
});

document.getElementById("view").addEventListener("click", e => {
  const t = e.target.closest("[data-add],[data-del],[data-pay],[data-goto],#saveBalance");
  if (!t) return;
  e.preventDefault();
  const ay = month();
  if (t.dataset.add) {
    const k = t.dataset.add;
    const blank = { sabit_giderler: { ad: "Yeni kalem", kategori: "diger", planlanan: 0, gerceklesen: 0, odeme_gunu: null },
      kisisel: { ad: "Yeni kalem", planlanan: 0, harcanan: 0 }, gelirler: { ad: "Yeni gelir", tutar: 0 } }[k];
    ay[k].push(blank);
  } else if (t.dataset.del) {
    const [k, i] = t.dataset.del.split(".");
    if (!confirm(`"${ay[k][i].ad}" silinsin mi?`)) return;
    ay[k].splice(Number(i), 1);
  } else if (t.dataset.pay) {
    const x = ay.sabit_giderler[Number(t.dataset.pay)];
    x.gerceklesen = x.planlanan;
    toast(`${x.ad} ödendi olarak işaretlendi.`);
  } else if (t.dataset.goto) {
    tab = t.dataset.goto;
  } else if (t.id === "saveBalance") {
    const v = parseTRNumber(document.getElementById("manualBalance").value);
    if (isNaN(v)) return toast("Geçerli bir tutar gir.");
    recordBalance(v, "Elle girildi");
  }
  save(); render();
});

function recordBalance(bakiye, kaynak) {
  month().banka_bakiyesi = bakiye;
  state.banka_kayitlari = state.banka_kayitlari || [];
  state.banka_kayitlari.push({ ay: current, bakiye, kaynak, zaman: new Date().toISOString() });
  const s = summary(month());
  toast(`Bakiye güncellendi: ${money(bakiye)} · Fark ${money(s.fark)}`);
}

// ---------- Garanti ekstresi ----------

function parseTRDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 864e5));
  const m = String(v || "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// Garanti'nin dışa aktarımında başlık satırı üstte hesap bilgileriyle gelir;
// "Bakiye" sütununu içeren satırı bulup altındaki hareketleri okuruz.
function readGarantiStatement(rows) {
  const norm = s => String(s ?? "").toLocaleLowerCase("tr-TR").trim();
  const hi = rows.findIndex(r => r.some(c => norm(c) === "bakiye"));
  if (hi < 0) {
    for (const r of rows) {
      const i = r.findIndex(c => /kullan[ıi]labilir bakiye|^bakiye/.test(norm(c)));
      if (i >= 0) {
        const v = r.slice(i + 1).map(parseTRNumber).find(n => !isNaN(n));
        if (v != null) return { bakiye: v, hareketler: [] };
      }
    }
    return null;
  }
  const h = rows[hi].map(norm);
  const col = name => h.findIndex(c => c.includes(name));
  const ci = { tarih: col("tarih"), aciklama: col("açıklama"), tutar: col("tutar"), bakiye: h.indexOf("bakiye") };
  const hareketler = rows.slice(hi + 1).map(r => ({
    tarih: parseTRDate(r[ci.tarih]),
    aciklama: ci.aciklama >= 0 ? String(r[ci.aciklama] ?? "") : "",
    tutar: ci.tutar >= 0 ? parseTRNumber(r[ci.tutar]) : NaN,
    bakiye: parseTRNumber(r[ci.bakiye]),
  })).filter(x => x.tarih && !isNaN(x.bakiye));
  if (!hareketler.length) return null;
  // Liste yeniden eskiye de, eskiden yeniye de gelebilir: en yeni tarihli satırın bakiyesini al.
  const desc = hareketler[0].tarih >= hareketler[hareketler.length - 1].tarih;
  const enYeni = desc ? hareketler[0] : hareketler[hareketler.length - 1];
  return { bakiye: enYeni.bakiye, tarih: enYeni.tarih, hareketler: desc ? hareketler : hareketler.slice().reverse() };
}

document.getElementById("view").addEventListener("change", async e => {
  if (e.target.id !== "bankFile" || !e.target.files[0]) return;
  e.stopImmediatePropagation();
  const file = e.target.files[0];
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const r = readGarantiStatement(rows);
    const box = document.getElementById("bankPreview");
    if (!r) { box.innerHTML = `<p class="neg">Dosyada bakiye sütunu bulunamadı.</p>`; return; }
    const giris = r.hareketler.filter(x => x.tutar > 0).reduce((a, x) => a + x.tutar, 0);
    const cikis = r.hareketler.filter(x => x.tutar < 0).reduce((a, x) => a + x.tutar, 0);
    box.innerHTML = `<div class="list" style="margin-top:12px">
      <div class="row"><div><div class="name">Son bakiye: ${money(r.bakiye)}</div><div class="meta">${r.tarih ? r.tarih.toLocaleDateString("tr-TR") : ""} · ${r.hareketler.length} hareket · giriş ${money(giris)}, çıkış ${money(-cikis)}</div></div>
      <button class="btn small" id="applyBank">Uygula</button></div>
      ${r.hareketler.slice(0, 6).map(x => `<div class="row"><div><div class="name">${esc(x.aciklama) || "—"}</div><div class="meta">${x.tarih.toLocaleDateString("tr-TR")}</div></div><div class="amt ${signCls(x.tutar)}">${isNaN(x.tutar) ? "" : money(x.tutar)}</div></div>`).join("")}
    </div>`;
    document.getElementById("applyBank").onclick = () => { recordBalance(r.bakiye, `Garanti ekstresi (${file.name})`); save(); render(); };
  } catch (err) {
    toast("Dosya okunamadı: " + err.message);
  }
}, true);

// ---------- Üst menü ----------

document.getElementById("tabs").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  tab = b.dataset.tab; render();
});
document.getElementById("monthSelect").addEventListener("change", e => setMonth(e.target.value));
document.getElementById("prevMonth").onclick = () => { const m = months(), i = m.indexOf(current); if (i > 0) setMonth(m[i - 1]); };
document.getElementById("nextMonth").onclick = () => { const m = months(), i = m.indexOf(current); if (i < m.length - 1) setMonth(m[i + 1]); };
function setMonth(k) { current = k; try { localStorage.setItem("butce.ay", k); } catch (e) {} render(); }

const menu = document.getElementById("menu");
document.getElementById("menuBtn").onclick = () => menu.classList.remove("hidden");
document.getElementById("closeMenu").onclick = () => menu.classList.add("hidden");
menu.addEventListener("click", e => { if (e.target === menu) menu.classList.add("hidden"); });

// Yeni ay: son ayın planı kopyalanır, gerçekleşenler sıfırlanır.
document.getElementById("newMonthBtn").onclick = () => {
  const last = latestMonth(), key = nextKey(last), src = state.aylar[last];
  const ay = structuredClone(src);
  ay.sabit_giderler.forEach(x => x.gerceklesen = 0);
  ay.kisisel.forEach(x => x.harcanan = 0);
  ay.haftalik_mutfak.forEach(x => x.harcanan = 0);
  ay.haftalik_genel.forEach(x => x.harcanan = 0);
  ay.banka_bakiyesi = null;
  state.aylar[key] = ay;
  save(); menu.classList.add("hidden"); setMonth(key);
  toast(`${monthLabel(key)} oluşturuldu (${monthLabel(last)} planı kopyalandı).`);
};

document.getElementById("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `butce-yedek-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};
document.getElementById("importBackup").onchange = async e => {
  try {
    const s = JSON.parse(await e.target.files[0].text());
    if (!s.aylar) throw new Error("Geçersiz yedek");
    state = migrate(s); current = latestMonth(); save(); menu.classList.add("hidden"); render(); toast("Yedek geri yüklendi.");
  } catch (err) { toast("Yedek okunamadı: " + err.message); }
};

let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); installPrompt = e;
  document.getElementById("installBtn").classList.remove("hidden");
});
document.getElementById("installBtn").onclick = () => installPrompt?.prompt();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.getElementById("view").addEventListener("change", async e => {
  if (!("ilkYukle" in e.target.dataset) || !e.target.files[0]) return;
  e.stopImmediatePropagation();
  try {
    const s = JSON.parse(await e.target.files[0].text());
    if (!s.aylar) throw new Error("Geçersiz yedek");
    state = migrate(s); current = latestMonth(); save(); render(); toast("Veriler yüklendi.");
  } catch (err) { toast("Yedek okunamadı: " + err.message); }
}, true);
document.getElementById("view").addEventListener("click", e => {
  if (!e.target.closest("[data-bos-basla]")) return;
  const k = bugunAyi();
  state.aylar[k] = { gelirler: [], cuzdana_cekilen: 0, sabit_giderler: [], kisisel: [], banka_bakiyesi: null,
    haftalik_mutfak: ["01-07", "08-14", "15-21", "22-28", "29-31"].map(h => ({ hafta: h, planlanan: 0, harcanan: 0 })),
    haftalik_genel: ["01-07", "08-14", "15-21", "22-28", "29-31"].map(h => ({ hafta: h, planlanan: 0, harcanan: 0 })) };
  current = k; save(); render();
});

if (!state.aylar[current]) current = latestMonth();
render();
