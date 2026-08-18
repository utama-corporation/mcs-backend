const express = require("express");
const verifyToken = require("../middleware/verifyToken"); // Middleware to verify JWT token
const moment = require("moment");
const { pool, connectDb } = require("../../db"); // Import MySQL connection pool
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const { broadcast } = require("../../websocket"); // Import dari root
const path = require("path"); // Pastikan path diimpor
const fs = require("fs");
require("moment/locale/id");
moment.locale("id"); // Set ke bahasa Indonesia

// Fetch data asset before
router.get(
  "/no-stock-opname-current-bom/:noso",
  verifyToken,
  async (req, res) => {
    try {
      await connectDb();

      const { noso } = req.params;
      const limit = 50;
      const offset = parseInt(req.query.offset) || 0;
      const companyQuery = req.query.company;
      const categoryQuery = req.query.category;
      const locationQuery = req.query.location;

      // 1. Ambil assetCode unik dari tb_stockopname_bom berdasarkan NoSO + filter dari tabel asset
      let filterConditions = "b.NoSO = ?";
      const filterParams = [noso];

      if (companyQuery) {
        const companies = companyQuery.split(",").map((c) => c.trim());
        const companyConds = companies
          .map(() => `a.CompanyName = ?`)
          .join(" OR ");
        filterConditions += ` AND (${companyConds})`;
        filterParams.push(...companies);
      }
      if (categoryQuery) {
        const categories = categoryQuery.split(",").map((c) => c.trim());
        const categoryConds = categories
          .map(() => `a.CategoryAsset = ?`)
          .join(" OR ");
        filterConditions += ` AND (${categoryConds})`;
        filterParams.push(...categories);
      }
      if (locationQuery) {
        const locations = locationQuery.split(",").map((l) => l.trim());
        const locationConds = locations
          .map(() => `a.LocationAsset = ?`)
          .join(" OR ");
        filterConditions += ` AND (${locationConds})`;
        filterParams.push(...locations);
      }

      // Ambil assetCode unik dengan paging
      const [assetCodesRows] = await pool.query(
        `SELECT DISTINCT b.AssetCode 
       FROM tb_stockopname_bom b 
       LEFT JOIN asset a ON b.AssetCode = a.AssetCode 
       WHERE ${filterConditions} 
       ORDER BY b.AssetCode DESC 
       LIMIT ? OFFSET ?`,
        [...filterParams, limit, offset],
      );

      const assetCodes = assetCodesRows.map((row) => row.AssetCode);

      if (assetCodes.length === 0) {
        return res.status(404).json({
          message: `Tidak ada asset BOM untuk NoSO: ${noso} dengan filter yang diberikan`,
        });
      }

      // 2. Query detail asset (mirip seperti query lama dari tb_stockopname_d, tapi sekarang dari asset)
      const dataQuery = `
      SELECT 
        a.AssetCode, 
        a.AssetName, 
        d.HasNotBeenPrinted, 
        d.Image, 
        s.status, 
        u.username,
        a.CompanyName,
        a.CategoryAsset,
        a.LocationAsset,
        att.filename
      FROM asset a
      LEFT JOIN tb_stockopname_d d ON a.AssetCode = d.AssetCode AND d.NoSO = ?
      LEFT JOIN tb_so_status s ON d.id_status = s.id_status
      LEFT JOIN tb_user u ON d.id_user = u.id_user
      LEFT JOIN (
        SELECT AssetCode, filename FROM (
          SELECT 
            AssetCode, 
            filename,
            ROW_NUMBER() OVER (
              PARTITION BY AssetCode 
              ORDER BY id ASC
            ) AS rn
          FROM tb_attachment_asset
          WHERE filename <> '' AND filename REGEXP '\\.(jpg|jpeg|png|gif|bmp|webp)$'
        ) t
        WHERE rn = 1
      ) att ON a.AssetCode = att.AssetCode
      WHERE a.AssetCode IN (?)
      ORDER BY a.AssetCode DESC
    `;

      const [rows] = await pool.query(dataQuery, [noso, assetCodes]);

      // 3. Hitung partsCount dari tb_stockopname_bom (bukan tb_parts_bom)
      let bomCountMap = {};
      if (assetCodes.length > 0) {
        const [bomCounts] = await pool.query(
          `
        SELECT AssetCode, COUNT(*) as partsCount
        FROM tb_stockopname_bom
        WHERE AssetCode IN (?) AND NoSO = ?
        GROUP BY AssetCode
      `,
          [assetCodes, noso],
        );

        bomCountMap = bomCounts.reduce((acc, item) => {
          acc[item.AssetCode] = item.partsCount;
          return acc;
        }, {});
      }

      // 4. Hitung qtyFound (jumlah parts yang ditemukan) dari tb_stockopname_hasil_bom
      let bomQtyFoundMap = {};
      if (assetCodes.length > 0) {
        const [foundCounts] = await pool.query(
          `
        SELECT AssetCode, COUNT(*) as totalFound
        FROM tb_stockopname_hasil_bom
        WHERE AssetCode IN (?) AND NoSO = ?
        GROUP BY AssetCode
      `,
          [assetCodes, noso],
        );

        bomQtyFoundMap = foundCounts.reduce((acc, item) => {
          acc[item.AssetCode] = parseInt(item.totalFound) || 0;
          return acc;
        }, {});
      }

      // 5. Pasangkan partsCount dan qtyFound ke setiap row
      rows.forEach((row) => {
        row.partsCount = bomCountMap[row.AssetCode] || 0;
        row.qtyFound = bomQtyFoundMap[row.AssetCode] || 0;
      });

      // 6. Hitung total untuk pagination
      const [countResult] = await pool.query(
        `
      SELECT COUNT(DISTINCT b.AssetCode) as total
      FROM tb_stockopname_bom b
      LEFT JOIN asset a ON b.AssetCode = a.AssetCode
      WHERE ${filterConditions}
    `,
        filterParams,
      );

      const total = countResult[0]?.total || 0;

      // 7. Kirim response
      res.json({
        data: rows,
        total,
        nextOffset: offset + limit,
        hasMore: offset + limit < total,
      });
    } catch (error) {
      console.error("Error:", error.message);
      res.status(500).json({
        message: "Internal Server Error",
        error: error.message,
      });
    }
  },
);

router.get("/part-bom", async (req, res) => {
  try {
    await connectDb(); // koneksi ke DB jika diperlukan

    const assetCode = req.query.assetCode;
    const noSO = req.query.noSO;

    if (!assetCode) {
      return res
        .status(400)
        .json({ message: "AssetCode is required as query parameter" });
    }

    // 🔍 Ambil semua data BOM berdasarkan AssetCode
    const [bomRows] = await pool.query(
      `
      SELECT 
        id,
        id_nested,
        AssetCode,
        level,
        parent,
        header,
        part,
        qty_on_hand,
        uom
      FROM tb_parts_bom
      WHERE AssetCode = ? AND is_active = 1
      ORDER BY level, part ASC
    `,
      [assetCode],
    );

    if (bomRows.length === 0) {
      return res.status(404).json({
        message: `Tidak ada data part untuk AssetCode: ${assetCode}`,
      });
    }

    // 🔍 Ambil data hasil stock opname (qty_found & remark)
    const [stockOpnameRows] = await pool.query(
      `
      SELECT 
        AssetCode,
        IdBOM,
        QtyFound,
        Remark
      FROM tb_stockopname_hasil_bom
      WHERE AssetCode = ? AND NosO = ?
    `,
      [assetCode, noSO],
    );

    // 🔁 Mapping berdasarkan IdBOM
    const qtyFoundMap = {};
    const remarkMap = {};

    stockOpnameRows.forEach((row) => {
      qtyFoundMap[row.IdBOM] = row.QtyFound;
      remarkMap[row.IdBOM] = row.Remark;
    });

    // 🖼️ Batch query attachment untuk semua bom id
    const allBomIds = bomRows.map((r) => r.id).filter(Boolean);
    const attachmentMap = {};
    if (allBomIds.length) {
      const placeholders = allBomIds.map(() => "?").join(",");
      const [attRows] = await pool.query(
        `SELECT part_id, filename, original_filename FROM tb_attachment_asset WHERE part_id IN (${placeholders})`,
        allBomIds,
      );
      attRows.forEach((att) => {
        if (!attachmentMap[att.part_id]) attachmentMap[att.part_id] = [];
        attachmentMap[att.part_id].push({
          filename: att.filename,
          original_filename: att.original_filename,
          url: `/api/attachment-asset/${encodeURIComponent(att.filename)}`,
        });
      });
    }

    // Kelompokkan data berdasarkan relationship dan sub parts
    const groupedData = [];
    const relationshipItems = bomRows.filter(
      (item) => item.level === "relationship",
    );
    const subItems = bomRows.filter((item) => item.level !== "relationship");

    relationshipItems.forEach((relationship) => {
      // Tambahkan relationship sebagai group
      const group = {
        id: relationship.id,
        id_nested: relationship.id_nested,
        AssetCode: relationship.AssetCode,
        level: relationship.level,
        header: relationship.header,
        part: relationship.part,
        uom: relationship.uom,
        qty_on_hand: parseFloat(relationship.qty_on_hand).toString(),
        qty_found:
          qtyFoundMap[relationship.id] !== undefined
            ? parseFloat(qtyFoundMap[relationship.id]).toString()
            : null,
        remark: remarkMap[relationship.id] || "",
        parts: [],
      };

      // Cari semua sub items yang parent-nya adalah id_nested dari relationship
      const relatedParts = subItems.filter(
        (item) => item.parent === relationship.id_nested,
      );

      // Format sub items
      relatedParts.forEach((part) => {
        group.parts.push({
          id: part.id,
          id_nested: part.id_nested,
          AssetCode: part.AssetCode,
          level: part.level,
          header: part.header,
          part: part.part,
          qty_on_hand: parseFloat(part.qty_on_hand).toString(),
          uom: part.uom,
          qty_found:
            qtyFoundMap[part.id] !== undefined
              ? parseFloat(qtyFoundMap[part.id]).toString()
              : null,
          remark: remarkMap[part.id] || "",
          attachments: attachmentMap[part.id] || [],
        });
      });

      groupedData.push(group);
    });

    // Tambahkan items yang tidak memiliki relationship (jika ada)
    const ungroupedItems = subItems.filter(
      (item) => !relationshipItems.some((rel) => rel.id_nested === item.parent),
    );

    ungroupedItems.forEach((item) => {
      groupedData.push({
        id: item.id,
        id_nested: item.id_nested,
        AssetCode: item.AssetCode,
        level: item.level,
        header: item.header,
        part: item.part,
        qty_on_hand: parseFloat(item.qty_on_hand).toString(),
        uom: item.uom,
        qty_found:
          qtyFoundMap[item.id] !== undefined
            ? parseFloat(qtyFoundMap[item.id]).toString()
            : null,
        remark: remarkMap[item.id] || "",
        attachments: attachmentMap[item.id] || [],
        parts: [],
      });
    });

    // ✅ Kirim response JSON
    res.json({
      assetCode,
      totalParts: bomRows.length,
      data: groupedData,
    });
  } catch (error) {
    console.error("Error saat mengambil part bom:", error.message);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

//SIMPAN HASIL BOM KE DB (SEMENTARA DI NONAKTIFKAN KARENA ADANYA PERUBAHAN RULES SAAT SUBMIT)
// router.post('/submit-bom', verifyToken, async (req, res) => {
//   try {
//     await connectDb();

//     const { noSO, assetCode, data } = req.body;
//     const idUser = req.user?.id_user || null;

//     if (!noSO || !assetCode || !Array.isArray(data)) {
//       return res.status(400).json({ message: 'noSO, assetCode dan data (array) diperlukan.' });
//     }

//     if (data.length === 0) {
//       return res.status(400).json({ message: 'Data BOM kosong.' });
//     }

//     // Mapping data untuk insert, termasuk Remark
//     const values = data.map(item => [
//       noSO,
//       assetCode,
//       item.idBOM,
//       item.qtyFound,
//       item.remark || null
//     ]);

//     // Simpan data hasil BOM
//     const [result] = await pool.query(
//       `INSERT INTO tb_stockopname_hasil_bom
//         (NoSO, AssetCode, IdBOM, QtyFound, Remark)
//        VALUES ?`,
//       [values]
//     );

//     // Update id_user pada tb_stockopname_d
//     if (idUser) {
//       await pool.query(
//         `UPDATE tb_stockopname_d
//          SET id_user = ?
//          WHERE NoSO = ? AND AssetCode = ?`,
//         [idUser, noSO, assetCode]
//       );
//     }

//     res.status(200).json({
//       message: 'Data BOM berhasil disimpan dan id_user diperbarui.',
//       insertedRows: result.affectedRows
//     });

//   } catch (error) {
//     console.error('Gagal menyimpan data BOM:', error.message);
//     res.status(500).json({
//       message: 'Internal Server Error',
//       error: error.message
//     });
//   }
// });

router.post("/submit-bom", verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noSO, assetCode, data } = req.body;
    const idUser = req.user?.id_user || null;

    if (!noSO || !assetCode || !Array.isArray(data)) {
      return res
        .status(400)
        .json({ message: "noSO, assetCode dan data (array) diperlukan." });
    }

    if (data.length === 0) {
      return res.status(400).json({ message: "Data BOM kosong." });
    }

    // Mapping data untuk UPSERT (update if exists)
    const values = data.map((item) => [
      noSO,
      assetCode,
      item.idBOM,
      item.qtyFound,
      item.remark || null,
    ]);

    const [result] = await pool.query(
      `INSERT INTO tb_stockopname_hasil_bom 
        (NoSO, AssetCode, IdBOM, QtyFound, Remark)
       VALUES ?
       ON DUPLICATE KEY UPDATE 
         QtyFound = VALUES(QtyFound),
         Remark = VALUES(Remark)`,
      [values],
    );

    // Update id_user pada tb_stockopname_d
    if (idUser) {
      await pool.query(
        `UPDATE tb_stockopname_d 
         SET id_user = ?
         WHERE NoSO = ? AND AssetCode = ?`,
        [idUser, noSO, assetCode],
      );
    }

    res.status(200).json({
      message: "Data BOM berhasil diperbarui.",
      affectedRows: result.affectedRows,
    });
  } catch (error) {
    console.error("Gagal mengupdate data BOM:", error.message);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

router.post("/update-bom", verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noSO, assetCode, data } = req.body;
    const idUser = req.user?.id_user || null;

    if (!noSO || !assetCode || !Array.isArray(data)) {
      return res
        .status(400)
        .json({ message: "noSO, assetCode dan data (array) diperlukan." });
    }

    if (data.length === 0) {
      return res.status(400).json({ message: "Data BOM kosong." });
    }

    // Mapping data untuk UPSERT (update if exists)
    const values = data.map((item) => [
      noSO,
      assetCode,
      item.idBOM,
      item.qtyFound,
      item.remark || null,
    ]);

    const [result] = await pool.query(
      `INSERT INTO tb_stockopname_hasil_bom 
        (NoSO, AssetCode, IdBOM, QtyFound, Remark)
       VALUES ?
       ON DUPLICATE KEY UPDATE 
         QtyFound = VALUES(QtyFound),
         Remark = VALUES(Remark)`,
      [values],
    );

    // Update id_user pada tb_stockopname_d
    if (idUser) {
      await pool.query(
        `UPDATE tb_stockopname_d 
         SET id_user = ?
         WHERE NoSO = ? AND AssetCode = ?`,
        [idUser, noSO, assetCode],
      );
    }

    res.status(200).json({
      message: "Data BOM berhasil diperbarui.",
      affectedRows: result.affectedRows,
    });
  } catch (error) {
    console.error("Gagal mengupdate data BOM:", error.message);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

///////////////////////////////////////////UNDER_CONSTRUCTION///////////////////////////////////////////////////////////

// Route to get Asset data based on NoSO
router.get("/no-stock-opname/:noso", verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noso } = req.params;
    const limit = 50;
    const offset = parseInt(req.query.offset) || 0;
    const companyQuery = req.query.company;
    const categoryQuery = req.query.category;
    const locationQuery = req.query.location;

    let filterConditions = "h.NoSO = ?";
    const queryParams = [noso];

    // ✅ Filter berdasarkan Company (langsung dari a.CompanyName)
    if (companyQuery) {
      const companyList = companyQuery.split(",").map((c) => c.trim());
      const companyConditions = companyList
        .map(() => `a.CompanyName = ?`)
        .join(" OR ");
      filterConditions += ` AND (${companyConditions})`;
      queryParams.push(...companyList);
    }

    // ✅ Filter berdasarkan Category (langsung dari a.CategoryAsset)
    if (categoryQuery) {
      const categoryList = categoryQuery.split(",").map((c) => c.trim());
      const categoryConditions = categoryList
        .map(() => `a.CategoryAsset = ?`)
        .join(" OR ");
      filterConditions += ` AND (${categoryConditions})`;
      queryParams.push(...categoryList);
    }

    // ✅ Filter berdasarkan Location (langsung dari a.LocationAsset)
    if (locationQuery) {
      const locationList = locationQuery.split(",").map((l) => l.trim());
      const locationConditions = locationList
        .map(() => `a.LocationAsset = ?`)
        .join(" OR ");
      filterConditions += ` AND (${locationConditions})`;
      queryParams.push(...locationList);
    }

    // Query data hasil scan
    const dataQuery = `
        SELECT 
          h.AssetCode, 
          u.Username, 
          a.AssetName,
          a.CompanyName,
          a.CategoryAsset,
          a.LocationAsset
        FROM tb_stockopname_d_hasil h
        LEFT JOIN asset a ON h.AssetCode = a.AssetCode
        LEFT JOIN tb_user u ON h.id_user = u.id_user
        WHERE ${filterConditions}
        ORDER BY h.DateTimeScan DESC
        LIMIT ? OFFSET ?
      `;
    queryParams.push(limit, offset);

    const [rows] = await pool.query(dataQuery, queryParams);

    // Query total count
    const countQuery = `
        SELECT COUNT(*) as total 
        FROM tb_stockopname_d_hasil h
        LEFT JOIN asset a ON h.AssetCode = a.AssetCode
        WHERE ${filterConditions}
      `;
    const [countResult] = await pool.query(
      countQuery,
      queryParams.slice(0, -2),
    );

    const total = countResult[0]?.total || 0;

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ message: `Tidak ada data asset untuk NoSO: ${noso}` });
    }

    res.json({
      data: rows,
      total,
      nextOffset: offset + limit,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

//UPDATE ASSET DETAIL PADA STOCKOPNAME_D
router.put("/update-stock-opname", verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noSO, assetCode, image, idStatus, isUpdateValid } = req.body;

    const idUser = req.user.id_user;

    console.log("🟡 ID User dari JWT:", idUser);

    // Validasi input
    if (!noSO || !assetCode) {
      return res
        .status(400)
        .json({ message: "NoSO dan AssetCode wajib diisi" });
    }

    let query = "";
    let values = [];

    if (isUpdateValid) {
      // Update data seperti biasa
      query = `
          UPDATE tb_stockopname_d 
          SET 
            HasNotBeenPrinted = 1, 
            Image = ?, 
            id_status = ?, 
            id_user = ? 
          WHERE NoSO = ? AND AssetCode = ?
        `;
      values = [image ?? null, idStatus ?? null, idUser, noSO, assetCode];
    } else {
      // Hapus gambar dari file system jika ada
      const imagePath = path.join(
        __dirname,
        "..",
        "..",
        "storage",
        "uploads",
        image,
      );

      try {
        // Cek apakah file gambar ada, lalu hapus
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath); // Hapus file
          console.log(`✅ File gambar ${image} berhasil dihapus`);
        } else {
          console.log(`⚠️ File gambar ${image} tidak ditemukan`);
        }
      } catch (err) {
        console.error(`❌ Gagal menghapus file gambar: ${err.message}`);
        // Lanjutkan proses meskipun gagal menghapus file
      }

      // Reset data
      query = `
          UPDATE tb_stockopname_d 
          SET 
            HasNotBeenPrinted = 0, 
            Image = NULL, 
            id_status = NULL, 
            id_user = NULL 
          WHERE NoSO = ? AND AssetCode = ?
        `;
      values = [noSO, assetCode];
    }

    const [result] = await pool.query(query, values);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "Data tidak ditemukan atau tidak berubah" });
    }

    res.json({ message: "Data berhasil diupdate" });
  } catch (error) {
    console.error("Update error:", error.message);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
});

// 🖼️ Proxy endpoint untuk serve gambar attachment dari network share
const ATTACHMENT_ASSET_PATH =
  "\\\\192.168.10.100\\WebServer\\xampp\\htdocs\\mcs\\assets\\docs\\masterAsset";

router.get("/attachment-asset/:filename", (req, res) => {
  const filename = req.params.filename;

  // Hanya izinkan karakter aman, cegah path traversal
  if (!/^[\w\-. ]+$/.test(filename)) {
    return res.status(400).json({ message: "Invalid filename" });
  }

  const filePath = path.join(ATTACHMENT_ASSET_PATH, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "File not found" });
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400"); // cache 1 hari
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
