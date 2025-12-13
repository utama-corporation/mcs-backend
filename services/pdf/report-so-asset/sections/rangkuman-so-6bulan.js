  const { pool } = require('../../../../db');

  // Fungsi untuk mengambil data riwayat SO 6 bulan terakhir (filter spesifik lokasi)
  async function fetchStockOpnameHistory(noSO) {
    try {
      // -----------------------------------------------------------------------
      // 1) Ambil info SO saat ini (tanggal + set location)
      // -----------------------------------------------------------------------
      const [currentSOData] = await pool.query(
        `
        SELECT 
          h.NoSO,
          COALESCE(h.LockedDate, h.Tanggal) AS TanggalSO,
          GROUP_CONCAT(DISTINCT loc.IdLocation ORDER BY loc.IdLocation) AS locations
        FROM tb_stockopname_h h
        LEFT JOIN tb_stockopname_dlocation  loc ON loc.NoSO = h.NoSO
        WHERE h.NoSO = ? AND h.IsBOM = 0
        GROUP BY h.NoSO, h.LockedDate, h.Tanggal
        `,
        [noSO]
      );

      if (!currentSOData || currentSOData.length === 0) {
        return [];
      }

      const currentData = currentSOData[0];

      if (!currentData.TanggalSO) {
        return [];
      }

      const currentDate = new Date(currentData.TanggalSO);
      const sixMonthsAgo = new Date(currentDate);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // Format tanggal untuk MySQL (YYYY-MM-DD HH:mm:ss)
      const formatDateForMySQL = (date) =>
        date.toISOString().slice(0, 19).replace('T', ' ');

      const sixMonthsAgoStr = formatDateForMySQL(sixMonthsAgo);
      const currentDateStr = formatDateForMySQL(currentDate);

      // Canonical representation lokasi (sudah diurutkan melalui GROUP_CONCAT ORDER BY)
      const locationsCanonical = currentData.locations || null;

      // Kalau SO sekarang tidak punya lokasi sama sekali, tidak usah cari riwayat
      if (!locationsCanonical) {
        return [];
      }

      // -----------------------------------------------------------------------
      // 2) Ambil kandidat NoSO dalam 6 bulan dengan lokasi persis sama
      // -----------------------------------------------------------------------
      const headerParams = [
        sixMonthsAgoStr,
        currentDateStr,
        locationsCanonical,
      ];
      
      const headerQuery = `
        SELECT
          h.NoSO,
          COALESCE(h.LockedDate, h.Tanggal) AS TanggalSO,
          GROUP_CONCAT(DISTINCT tloc.IdLocation ORDER BY tloc.IdLocation) AS locations
        FROM tb_stockopname_h h
        LEFT JOIN tb_stockopname_dlocation tloc ON tloc.NoSO = h.NoSO
        WHERE h.IsBOM = 0
          AND COALESCE(h.LockedDate, h.Tanggal) IS NOT NULL
          AND COALESCE(h.LockedDate, h.Tanggal) BETWEEN ? AND ?
        GROUP BY h.NoSO, h.LockedDate, h.Tanggal
        HAVING locations <=> ?
        ORDER BY COALESCE(h.LockedDate, h.Tanggal) DESC
      `; // ⬅️ LIMIT dipindah ke JS

      const [rawHeaderRows] = await pool.query(headerQuery, headerParams);

      // Kalau nggak ada riwayat sama sekali, tetap boleh tampil tapi minimal SO sekarang
      let headerRows = rawHeaderRows || [];

      // -----------------------------------------------------------------------
      // 2a) PASTIKAN NoSO parameter ikutan
      // -----------------------------------------------------------------------
      const alreadyHasCurrent = headerRows.some(r => r.NoSO === currentData.NoSO);

      if (!alreadyHasCurrent) {
        headerRows.push({
          NoSO: currentData.NoSO,
          TanggalSO: currentData.TanggalSO,
          locations: locationsCanonical,
        });
      }

      // Urutkan desc by tanggal, lalu ambil maksimal 6
      headerRows = headerRows
        .sort((a, b) => new Date(b.TanggalSO) - new Date(a.TanggalSO))
        .slice(0, 6); // ⬅️ Limit 6 di sini

      if (!headerRows || headerRows.length === 0) {
        return [];
      }

      const soList = headerRows.map((r) => r.NoSO);

      // -----------------------------------------------------------------------
      // 3) Agregasi per tabel (dibatasi NoSO IN (list headerRows yang sudah fix)
      // -----------------------------------------------------------------------

      // Siapkan map NoSO -> data awal
      const resultMap = new Map();
      for (const row of headerRows) {
        resultMap.set(row.NoSO, {
          NoSO: row.NoSO,
          TanggalSO: row.TanggalSO,
          TotalAset: 0,
          HasilScan: 0,
          AsetTidakDitemukan: 0,
          AsetTanpaQR: 0,
          AsetTemuan: 0,
        });
      }

      // 3.a) TotalAset & AsetTanpaQR dari tb_stockopname_d
      const [totalRows] = await pool.query(
        `
        SELECT
          d.NoSO,
          COUNT(DISTINCT d.AssetCode) AS TotalAset,
          COUNT(DISTINCT CASE WHEN d.HasNotBeenPrinted = 1 THEN d.AssetCode END) AS AsetTanpaQR
        FROM tb_stockopname_d d
        WHERE d.NoSO IN (?)
        GROUP BY d.NoSO
        `,
        [soList]
      );

      for (const row of totalRows) {
        const item = resultMap.get(row.NoSO);
        if (item) {
          item.TotalAset = row.TotalAset || 0;
          item.AsetTanpaQR = row.AsetTanpaQR || 0;
        }
      }

      // 3.b) HasilScan dari tb_stockopname_d_hasil
      const [scanRows] = await pool.query(
        `
        SELECT
          dh.NoSO,
          COUNT(DISTINCT dh.AssetCode) AS HasilScan
        FROM tb_stockopname_d_hasil dh
        WHERE dh.NoSO IN (?)
        GROUP BY dh.NoSO
        `,
        [soList]
      );

      for (const row of scanRows) {
        const item = resultMap.get(row.NoSO);
        if (item) {
          item.HasilScan = row.HasilScan || 0;
        }
      }

      // 3.c) AsetTidakDitemukan
      const [missingRows] = await pool.query(
        `
        SELECT
          d.NoSO,
          COUNT(DISTINCT d.AssetCode) AS AsetTidakDitemukan
        FROM tb_stockopname_d d
        LEFT JOIN tb_stockopname_d_hasil h2
          ON h2.NoSO = d.NoSO
        AND h2.AssetCode = d.AssetCode
        WHERE d.NoSO IN (?)
          AND d.HasNotBeenPrinted != 1
          AND h2.AssetCode IS NULL
        GROUP BY d.NoSO
        `,
        [soList]
      );

      for (const row of missingRows) {
        const item = resultMap.get(row.NoSO);
        if (item) {
          item.AsetTidakDitemukan = row.AsetTidakDitemukan || 0;
        }
      }

      // 3.d) AsetTemuan
      const [nonAssetRows] = await pool.query(
        `
        SELECT
          na.NoSO,
          COUNT(*) AS AsetTemuan
        FROM tb_stockopname_non_assets na
        WHERE na.NoSO IN (?)
        GROUP BY na.NoSO
        `,
        [soList]
      );

      for (const row of nonAssetRows) {
        const item = resultMap.get(row.NoSO);
        if (item) {
          item.AsetTemuan = row.AsetTemuan || 0;
        }
      }

      // -----------------------------------------------------------------------
      // 4) Kembalikan sebagai array, urut desc TanggalSO
      // -----------------------------------------------------------------------
      const historyRows = Array.from(resultMap.values()).sort(
        (a, b) => new Date(b.TanggalSO) - new Date(a.TanggalSO)
      );

      return historyRows;
    } catch (error) {
      console.error('Error in fetchStockOpnameHistory:', error);
      throw error;
    }
  }


  function drawHistoryTableHeader(doc, startX, y, columns, headerHeight = 25) {
    doc.font('Helvetica-Bold').fontSize(9);

    const verticalPadding = 3; // minimal jarak dari garis atas

    let currentX = startX;
    columns.forEach((col) => {
      // kotak header
      doc.rect(currentX, y, col.width, headerHeight).stroke();

      // tinggi teks di dalam lebar kolom
      const textHeight = doc.heightOfString(col.text, {
        width: col.width - 6,
        align: 'center',
        lineGap: 1,
      });

      // Y teks: di tengah, tapi minimal ada verticalPadding dari atas
      const textY =
        y +
        Math.max(
          verticalPadding,
          (headerHeight - textHeight) / 2
        );

      // teks center horizontal
      doc.text(col.text, currentX + 3, textY, {
        width: col.width - 6,
        align: 'center',
        lineGap: 1,
      });

      currentX += col.width;
    });

    return y + headerHeight;
  }


  // ⬇️ Versi baru: hanya kolom Bulan + 5 angka summary
  function printStockOpnameHistoryTable(doc, historyData) {
    if (historyData.length === 0) return;

    const startX = doc.page.margins.left;
    const tableWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Bulan dibuat agak sempit, sisanya rata
    const colBulanWidth = 40;
    const colNumberWidth = (tableWidth - colBulanWidth) / 5;

    const headerHeight = 25;
    const rowPadding = 3;

    const headers = [
      { text: 'Bulan', width: colBulanWidth },
      { text: 'Total Aset', width: colNumberWidth },
      { text: 'Hasil Scan', width: colNumberWidth },
      { text: 'Aset Tidak Ditemukan', width: colNumberWidth },
      { text: 'Aset Tanpa QR', width: colNumberWidth },
      { text: 'Aset Temuan', width: colNumberWidth },
    ];

    const drawHeader = (doc, yPos) =>
      drawHistoryTableHeader(doc, startX, yPos, headers, headerHeight);

    // Draw header pertama kali
    let y = doc.y;
    y = drawHeader(doc, y);

    doc.font('Helvetica').fontSize(8);

    historyData.forEach((item) => {
      const date = new Date(item.TanggalSO);
      const bulan = (date.getMonth() + 1).toString(); // 1–12

      const bulanText = bulan;
      const totalAsetText = item.TotalAset.toString();
      const hasilScanText = item.HasilScan.toString();
      const tidakDitemukanText = item.AsetTidakDitemukan.toString();
      const tanpaQRText = item.AsetTanpaQR.toString();
      const temuanText = item.AsetTemuan.toString();

      // Karena isinya angka pendek semua, tinggi baris bisa fixed
      const heightBulan = doc.heightOfString(bulanText, {
        width: colBulanWidth - 6,
      });
      const heightTotalAset = doc.heightOfString(totalAsetText, {
        width: colNumberWidth - 6,
      });
      const heightHasilScan = doc.heightOfString(hasilScanText, {
        width: colNumberWidth - 6,
      });
      const heightTidakDitemukan = doc.heightOfString(tidakDitemukanText, {
        width: colNumberWidth - 6,
      });
      const heightTanpaQR = doc.heightOfString(tanpaQRText, {
        width: colNumberWidth - 6,
      });
      const heightTemuan = doc.heightOfString(temuanText, {
        width: colNumberWidth - 6,
      });

      const rowHeight =
        Math.max(
          heightBulan,
          heightTotalAset,
          heightHasilScan,
          heightTidakDitemukan,
          heightTanpaQR,
          heightTemuan
        ) +
        rowPadding * 2;

      // Check jika perlu pindah halaman
      const maxY = doc.page.height - doc.page.margins.bottom - 30;
      if (y + rowHeight > maxY) {
        doc.addPage();
        doc.x = doc.page.margins.left;
        doc.y = doc.page.margins.top;
        y = doc.y;
        y = drawHeader(doc, y);
        doc.font('Helvetica').fontSize(8);
      }

      // Draw cells
      let currentX = startX;
      headers.forEach((header) => {
        doc.rect(currentX, y, header.width, rowHeight).stroke();
        currentX += header.width;
      });

      // Isi text per kolom
      let colX = startX;

      doc.text(bulanText, colX + 3, y + rowPadding, {
        width: colBulanWidth - 6,
        align: 'center',
      });
      colX += colBulanWidth;

      doc.text(totalAsetText, colX + 3, y + rowPadding, {
        width: colNumberWidth - 6,
        align: 'center',
      });
      colX += colNumberWidth;

      doc.text(hasilScanText, colX + 3, y + rowPadding, {
        width: colNumberWidth - 6,
        align: 'center',
      });
      colX += colNumberWidth;

      doc.text(tidakDitemukanText, colX + 3, y + rowPadding, {
        width: colNumberWidth - 6,
        align: 'center',
      });
      colX += colNumberWidth;

      doc.text(tanpaQRText, colX + 3, y + rowPadding, {
        width: colNumberWidth - 6,
        align: 'center',
      });
      colX += colNumberWidth;

      doc.text(temuanText, colX + 3, y + rowPadding, {
        width: colNumberWidth - 6,
        align: 'center',
      });

      y += rowHeight;
    });

    doc.y = y + 10;
  }

  // Fungsi utama untuk mencetak riwayat SO 6 bulan terakhir
  async function printStockOpnameHistory(doc, noSO) {
    try {
      const historyData = await fetchStockOpnameHistory(noSO);

      doc.moveDown(1);
      doc.x = doc.page.margins.left;

      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .text('II. Rangkuman Stock Opname (6 Bulan)', {
          align: 'left',
        });

      doc.moveDown(0.5);

      if (historyData.length === 0) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .text(
            'Tidak ada riwayat SO dalam 6 bulan terakhir dengan lokasi yang sama',
            {
              align: 'left',
            }
          );
        doc.moveDown(1);
        return;
      }

      printStockOpnameHistoryTable(doc, historyData);
    } catch (error) {
      console.error('Error in printStockOpnameHistory:', error);
      throw error;
    }
  }

  module.exports = {
    printStockOpnameHistory,
    fetchStockOpnameHistory,
  };
