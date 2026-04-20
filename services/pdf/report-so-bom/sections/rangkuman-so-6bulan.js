// sections/stockopname/rangkuman_so_6bulan_totals.js
const { pool } = require("../../../../db");

// ==== utils ====

function formatSelisih(value) {
  const number = parseFloat(value ?? 0);
  if (!Number.isFinite(number) || number === 0) return "0";

  const absStr = formatQty(Math.abs(number)); // pakai formatQty biar 1/1.00 konsisten

  return number > 0 ? `+${absStr}` : `-${absStr}`;
}

function getTextHeight(doc, text, options) {
  return doc.heightOfString(String(text ?? "-"), options);
}
function fmtDate(d) {
  if (!d) return "-";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function monthKey(d) {
  // 2025-11-10 -> '2025-11'
  if (!d) return "-";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
}
function getLast6MonthKeys(tanggalAcuan, count = 6) {
  const acuan =
    tanggalAcuan instanceof Date ? tanggalAcuan : new Date(tanggalAcuan);
  if (Number.isNaN(acuan.getTime())) return [];

  const keys = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(acuan.getFullYear(), acuan.getMonth() - i, 1);
    keys.push(monthKey(dt));
  }
  return keys; // terbaru -> terlama
}
function formatQty(value) {
  const number = parseFloat(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  const s = number.toFixed(2).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
}
function buildInPlaceholders(arr) {
  return arr.map(() => "?").join(",");
}

// ==== ambil SET acuan (Company/Category/Location) + tanggal NoSO acuan ====
async function getBaseSetsAndDate(noSO) {
  const [[header]] = await pool.query(
    "SELECT NoSO, Tanggal, IsBOM FROM tb_stockopname_h WHERE NoSO = ? LIMIT 1",
    [noSO],
  );
  if (!header)
    throw new Error(`NoSO '${noSO}' tidak ditemukan di tb_stockopname_h`);

  const [companies] = await pool.query(
    "SELECT IdCompany FROM tb_stockopname_dcompany WHERE NoSO = ? ORDER BY NoSO DESC, IdCompany ASC",
    [noSO],
  );
  const [categories] = await pool.query(
    "SELECT IdCategory FROM tb_stockopname_dcategory WHERE NoSO = ? ORDER BY NoSO DESC, IdCategory ASC",
    [noSO],
  );
  const [locations] = await pool.query(
    "SELECT IdLocation FROM tb_stockopname_dlocation WHERE NoSO = ? ORDER BY NoSO DESC, IdLocation ASC",
    [noSO],
  );

  return {
    tanggalAcuan: header.Tanggal,
    setCompany: companies.map((r) => r.IdCompany).filter((v) => v != null),
    setCategory: categories.map((r) => r.IdCategory).filter((v) => v != null),
    setLocation: locations.map((r) => r.IdLocation).filter((v) => v != null),
  };
}

// ==== cari NoSO lain (6 bulan kalender) yang match 3 tabel & IsBOM=1 (SELF di-exclude di sini) ====
async function getSixMonthMatches(
  noSO,
  tanggalAcuan,
  setCompany,
  setCategory,
  setLocation,
) {
  if (!setCompany.length || !setCategory.length || !setLocation.length)
    return [];

  const acuan = new Date(tanggalAcuan);
  if (Number.isNaN(acuan.getTime())) throw new Error("Tanggal acuan invalid");

  // Window 7 bulan kalender: bulan acuan + 6 bulan ke belakang (bulan ke-7 untuk baseline delta).
  const start = new Date(acuan.getFullYear(), acuan.getMonth() - 6, 1);
  const end = new Date(acuan.getFullYear(), acuan.getMonth() + 1, 0);

  const inCompany = buildInPlaceholders(setCompany);
  const inCategory = buildInPlaceholders(setCategory);
  const inLocation = buildInPlaceholders(setLocation);

  const sql = `
    SELECT h.NoSO, h.Tanggal
    FROM tb_stockopname_h h
    JOIN tb_stockopname_dcompany  dc  ON dc.NoSO  = h.NoSO
    JOIN tb_stockopname_dcategory cat ON cat.NoSO = h.NoSO
    JOIN tb_stockopname_dlocation dl  ON dl.NoSO  = h.NoSO
    WHERE h.Tanggal BETWEEN ? AND ?
      AND h.NoSO <> ?
      AND h.IsBOM = 1
      AND dc.IdCompany   IN (${inCompany})
      AND cat.IdCategory IN (${inCategory})
      AND dl.IdLocation  IN (${inLocation})
    GROUP BY h.NoSO, h.Tanggal
    ORDER BY h.Tanggal DESC, h.NoSO DESC
  `;
  const params = [
    fmtDate(start),
    fmtDate(end),
    noSO,
    ...setCompany,
    ...setCategory,
    ...setLocation,
  ];
  const [rows] = await pool.query(sql, params);
  return rows; // [{NoSO, Tanggal}, ...]
}

// ==== ambil total qty sistem & fisik per NoSO (batch) ====
async function getTotalsForNoSOs(noSoList) {
  if (!noSoList.length) return [];

  const placeholders = buildInPlaceholders(noSoList);
  const sql = `
    SELECT
      so.NoSO,
      SUM(COALESCE(so.Qty, 0))       AS TotalQtySistem,
      SUM(COALESCE(hsl.QtyFound, 0)) AS TotalQtyFisik
    FROM tb_stockopname_bom so
    LEFT JOIN tb_stockopname_hasil_bom hsl
      ON hsl.IdBOM = so.IdBOM AND hsl.NoSO = so.NoSO
    WHERE so.NoSO IN (${placeholders})
    GROUP BY so.NoSO
  `;
  const [rows] = await pool.query(sql, noSoList);
  const map = new Map(rows.map((r) => [r.NoSO, r]));
  return noSoList.map((noso) => ({
    NoSO: noso,
    TotalQtySistem: Number(map.get(noso)?.TotalQtySistem ?? 0),
    TotalQtyFisik: Number(map.get(noso)?.TotalQtyFisik ?? 0),
  }));
}

/**
 * Section: Rangkuman SO 6 Bulan Terakhir - Output minimal:
 * Kolom: Bulan(YYYY-MM), Qty Sistem, Qty Fisik, Selisih (Fisik - Sistem)
 * Catatan: Data diakumulasi per bulan agar hasil tepat 6 bulan terakhir.
 */
async function renderRangkumanSO6BulanTotals(doc, noSO) {
  // 1) acuan
  const { tanggalAcuan, setCompany, setCategory, setLocation } =
    await getBaseSetsAndDate(noSO);

  // 2) daftar NoSO lain (IsBOM=1, 6 bulan kalender, match 3 tabel)
  const matches = await getSixMonthMatches(
    noSO,
    tanggalAcuan,
    setCompany,
    setCategory,
    setLocation,
  );

  // 3) ambil total qty (self + others)
  const uniqueNos = Array.from(new Set([noSO, ...matches.map((m) => m.NoSO)]));
  const totals = await getTotalsForNoSOs(uniqueNos);
  const totalsMap = new Map(totals.map((t) => [t.NoSO, t]));

  // 4) siapkan rows: agregasi per bulan (7 bulan untuk baseline delta, tampil 6)
  const monthKeys7 = getLast6MonthKeys(tanggalAcuan, 7);
  const monthBuckets = new Map(
    monthKeys7.map((k) => [k, { QtySistem: 0, QtyFisik: 0 }]),
  );
  // allDocs: SO acuan di depan, sisanya sudah DESC (terbaru dulu) dari query
  const allDocs = [{ NoSO: noSO, Tanggal: tanggalAcuan }, ...matches];
  const filledMonths = new Set();
  for (const item of allDocs) {
    const key = monthKey(item.Tanggal);
    if (!monthBuckets.has(key)) continue;
    // Hanya pakai 1 SO per bulan (SO terbaru / SO acuan untuk bulan acuan)
    if (filledMonths.has(key)) continue;
    filledMonths.add(key);

    const t = totalsMap.get(item.NoSO) || {
      TotalQtySistem: 0,
      TotalQtyFisik: 0,
    };
    monthBuckets.get(key).QtySistem += Number(t.TotalQtySistem || 0);
    monthBuckets.get(key).QtyFisik += Number(t.TotalQtyFisik || 0);
  }

  const rows7 = monthKeys7.map((k) => {
    const val = monthBuckets.get(k) || { QtySistem: 0, QtyFisik: 0 };
    return {
      Bulan: String(parseInt(k.split("-")[1], 10)),
      QtySistem: val.QtySistem,
      QtyFisik: val.QtyFisik,
      Selisih: val.QtyFisik - val.QtySistem,
    };
  });

  // Hitung delta untuk 6 bulan tampilan (index 0-5), menggunakan bulan ke-7 (index 6) sebagai baseline
  for (let i = 0; i < 6; i++) {
    rows7[i].DeltaQtySistem = rows7[i].QtySistem - rows7[i + 1].QtySistem;
    rows7[i].DeltaQtyFisik = rows7[i].QtyFisik - rows7[i + 1].QtyFisik;
  }

  // Hanya tampilkan 6 bulan terbaru
  const rows = rows7.slice(0, 6);

  // 5) render tabel minimal
  const left = doc.page.margins.left;

  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .text("II. Rangkuman Stock Opname (6 bulan)", left, doc.y, {
      align: "left",
    });
  doc.moveDown(0.8);

  if (!rows.length) {
    doc
      .fontSize(11)
      .font("Helvetica")
      .text("Tidak ada data untuk ditampilkan.", left, doc.y, {
        align: "left",
      });
    doc.moveDown(1.0);
    return;
  }

  // Kolom: Bulan | [Qty Sistem | Delta] | [Qty Fisik | Delta] | Selisih
  // col index:  0       1         2          3        4          5
  const colWidths = [70, 100, 40, 100, 40, 80]; // Bulan, QtySistem, DeltaSistem, QtyFisik, DeltaFisik, Selisih
  // Indeks kolom Delta — sisi kiri kolom ini adalah divider sub-kolom
  const subDividerCols = new Set([2, 4]);
  const subDividerWidth = 1; // <-- atur ketebalan divider di sini (pt)
  const colX = [];
  let x = doc.page.margins.left;
  for (const w of colWidths) {
    colX.push(x);
    x += w;
  }

  // Grup header atas: Bulan, Qty Sistem (span 2 kolom), Qty Fisik (span 2 kolom), Selisih
  const groupHeaders = [
    { label: "Bulan", colStart: 0, span: 1 },
    { label: "Qty Sistem", colStart: 1, span: 2 },
    { label: "Qty Fisik", colStart: 3, span: 2 },
    { label: "Selisih", colStart: 5, span: 1 },
  ];
  doc.fontSize(10).font("Helvetica-Bold");
  const groupRowH = 20;
  let y = doc.y;

  const drawHeader = (startY) => {
    doc.fontSize(10).font("Helvetica-Bold");
    let hy = startY;
    // Hanya gambar merged rect per grup — tidak ada divider internal di dalam grup
    for (const g of groupHeaders) {
      const gx = colX[g.colStart];
      const gw = colWidths
        .slice(g.colStart, g.colStart + g.span)
        .reduce((a, b) => a + b, 0);
      doc.rect(gx, hy, gw, groupRowH).stroke();
      doc.text(g.label, gx + 3, hy + (groupRowH - 10) / 2, {
        width: gw - 6,
        align: "center",
      });
    }
    return hy + groupRowH;
  };

  y = drawHeader(y);

  doc.font("Helvetica").fontSize(10);

  for (const r of rows) {
    const data = [
      r.Bulan,
      formatQty(r.QtySistem),
      r.DeltaQtySistem !== undefined ? formatSelisih(r.DeltaQtySistem) : "-",
      formatQty(r.QtyFisik),
      r.DeltaQtyFisik !== undefined ? formatSelisih(r.DeltaQtyFisik) : "-",
      formatSelisih(r.Selisih),
    ];

    // tinggi baris
    let maxH = 0;
    for (let i = 0; i < data.length; i++) {
      const h = getTextHeight(doc, String(data[i]), {
        width: colWidths[i] - 6,
      });
      if (maxH < h) maxH = h;
    }
    const rowH = maxH + 10;

    // page break
    if (y + rowH > 780) {
      doc.addPage();
      y = drawHeader(doc.page.margins.top);
      doc.font("Helvetica").fontSize(10);
    }

    for (let i = 0; i < data.length; i++) {
      if (subDividerCols.has(i)) {
        // Gambar border sel dengan ketebalan divider sub-kolom
        doc
          .save()
          .lineWidth(subDividerWidth)
          .rect(colX[i], y, colWidths[i], rowH)
          .stroke()
          .restore();
      } else {
        doc.rect(colX[i], y, colWidths[i], rowH).stroke();
      }
      doc.text(String(data[i]), colX[i] + 3, y + 5, {
        width: colWidths[i] - 6,
        align: "center",
      });
    }
    y += rowH;
  }

  doc.moveDown(1.0);
}

module.exports = { renderRangkumanSO6BulanTotals };
