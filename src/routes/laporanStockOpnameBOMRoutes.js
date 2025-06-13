const express = require('express');
const moment = require('moment');
const PDFDocument = require('pdfkit');
const { pool, connectDb } = require('../../db');
const router = express.Router();

router.get('/report-so-bom/:noso/pdf', async (req, res) => {
    try {
      await connectDb();
  
      const noSO = req.params.noso;
      const tanggal = req.query.tanggal;
      const lockedDate = req.query.lockeddate || "-";
      const perusahaan = req.query.perusahaan;
      const lokasi = req.query.lokasi;
  
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
  
      res.setHeader('Content-Type', 'application/pdf');
      const safeNoSO = noSO.replace(/\./g, '_');
      res.setHeader('Content-Disposition', `inline; filename=Laporan_${safeNoSO}.pdf`);
  
      doc.pipe(res);
  
      doc.fontSize(16).font('Helvetica-Bold').text('BERITA ACARA STOCK OPNAME', { align: 'center' });
      doc.moveDown(1.5);
  
      doc.fontSize(12).font('Helvetica-Bold').text(`Tanggal : ${tanggal || '-'}`);
      doc.moveDown(0.5);
  
      doc.fontSize(12).font('Helvetica-Bold').text(`Perusahaan : ${perusahaan || '-'}`);
      doc.moveDown(0.5);
  
      doc.fontSize(12).font('Helvetica-Bold').text(`Lokasi : ${lokasi || '-'}`);
      doc.moveDown(1);
  
      const [rows] = await pool.query(`
        SELECT 
        asset.AssetName AS AssetCode,
        bom.part AS part_name,
        bom.qty_on_hand,
        hasil.QtyFound,
        hasil.Remark
        FROM tb_parts_bom bom
        JOIN (
        SELECT DISTINCT AssetCode
        FROM tb_stockopname_d
        WHERE NoSO = ?
        ) stok ON bom.AssetCode = stok.AssetCode
        LEFT JOIN tb_stockopname_hasil_bom hasil
        ON bom.id = hasil.IdBOM AND hasil.NoSO = ?
        LEFT JOIN asset ON bom.AssetCode = asset.AssetCode
        WHERE bom.level != 'relationship'
        ORDER BY bom.AssetCode ASC, bom.part ASC
      `, [noSO, noSO]);
      
  
      if (rows.length === 0) {
        doc.text('Tidak ada data hasil stock opname.');
        doc.end();
        return;
      }
  
      doc.fontSize(13).font('Helvetica-Bold').text('I. Hasil Stock Opname');
      doc.moveDown(0.8);
  
      const grouped = {};
      rows.forEach(row => {
        if (!grouped[row.AssetCode]) grouped[row.AssetCode] = [];
        grouped[row.AssetCode].push(row);
      });
  
      const colX = [40, 70, 250, 310, 370, 430]; // X positions
      const colWidths = [30, 180, 60, 60, 60, 140];
      const rowHeight = 20;
      let y = doc.y;
      let groupIndex = 1;
  
      for (const [assetCode, parts] of Object.entries(grouped)) {
        if (y > 700) {
          doc.addPage();
          y = doc.y;
        }
  
        doc.fontSize(11).font('Helvetica-Bold').text(`${groupIndex}. ${assetCode}`, colX[0], y);
        y += 25;
  
        // Draw header row with borders
        doc.fontSize(10).font('Helvetica-Bold');
  
        const headers = ['No', 'Nama Alat Kerja', 'Jumlah di Sistem', 'Jumlah Fisik', 'Selisih', 'Keterangan'];

        // Hitung tinggi maksimal dari header (karena ada teks 2 baris)
        let headerMaxHeight = 0;
        for (let i = 0; i < headers.length; i++) {
          const height = getTextHeight(doc, headers[i], {
            width: colWidths[i] - 6,
            align: 'left'
          });
          if (height > headerMaxHeight) headerMaxHeight = height;
        }
        const headerRowHeight = headerMaxHeight + 10;
        
        for (let i = 0; i < headers.length; i++) {
          doc.rect(colX[i], y, colWidths[i], headerRowHeight).stroke();
          const textHeight = getTextHeight(doc, headers[i], {
            width: colWidths[i] - 6
          });
          const textY = y + (headerRowHeight - textHeight) / 2;
          
          doc.text(headers[i], colX[i] + 3, textY, {
            width: colWidths[i] - 6,
            align: 'center'
          });
          
        }
        y += headerRowHeight;
        
  
        doc.font('Helvetica').fontSize(10);
        let nomor = 1;
          
        for (const row of parts) {
            const sistem = row.qty_on_hand || 0;
            const fisik = row.QtyFound || 0;
            let selisihValue = Math.abs(fisik - sistem); // ambil nilai mutlak
            let selisih = '0';
            
            if (fisik > sistem) {
              selisih = `+${selisihValue}`;
            } else if (fisik < sistem) {
              selisih = `${selisihValue}`;
            }
            
                      
            const data = [
              nomor,
              row.part_name || '-',
              String(row.qty_on_hand ?? '-'),
              String(row.QtyFound ?? '-'),
              String(selisih),
              row.Remark || '-'
            ];
          
            // Hitung tinggi maksimal dari semua kolom dalam satu baris
            let maxHeight = 0;
            for (let i = 0; i < data.length; i++) {
              const height = getTextHeight(doc, data[i], {
                width: colWidths[i] - 6,
                align: 'left'
              });
              if (height > maxHeight) maxHeight = height;
            }
          
            // Tambahkan padding atas dan bawah
            const rowHeightDynamic = maxHeight + 10;
          
            // Cek apakah perlu page break
            if (y + rowHeightDynamic > 780) {
                doc.addPage();
                y = 40;
                // Tidak usah menggambar header lagi
              }
              
          
            // Gambar cell dan isi teks
            for (let i = 0; i < data.length; i++) {
              doc.rect(colX[i], y, colWidths[i], rowHeightDynamic).stroke();
              const centerAlignedCols = [0, 2, 3, 4]; // index kolom yg ingin di-center

              doc.text(data[i], colX[i] + 3, y + 5, {
                width: colWidths[i] - 6,
                align: centerAlignedCols.includes(i) ? 'center' : 'left'
              });
              
            }
          
            y += rowHeightDynamic;
            nomor++;
          }
          
  
        y += 20;
        groupIndex++;
      }
  
      doc.end();
    } catch (error) {
      console.error('❌ Error:', error.message);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  });


  function getTextHeight(doc, text, options) {
    return doc.heightOfString(String(text ?? '-'), options);
  }
  

module.exports = router;
