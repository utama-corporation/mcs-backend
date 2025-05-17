const express = require('express');
const verifyToken = require('../middleware/verifyToken'); // Middleware to verify JWT token
const moment = require('moment');
const { pool, connectDb } = require('../db');  // Import MySQL connection pool
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const { broadcast } = require('../websocket'); // Import dari root
const path = require('path'); // Pastikan path diimpor
const fs = require('fs');


// Helper function to format dates using Moment.js
const formatDate = (date) => {
  return moment(date).format('DD MMM YYYY');
};


// Route to get Stock Opname Number
router.get('/no-stock-opname', verifyToken, async (req, res) => {
  try {
    // Query the main table to get NoSO and Tanggal
    const [rows] = await pool.query('SELECT NoSO, Tanggal FROM tb_stockopname_h');

    // If no records are found, return 404 error
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Tidak ada Jadwal Stock Opname saat ini' });
    }

    // Process each NoSO to get related companies, categories, and locations
    const result = await Promise.all(
      rows.map(async (item) => {
        const { NoSO, Tanggal } = item;

        // Query to get related companies for the current NoSO
        const [companies] = await pool.query(
          'SELECT IdCompany FROM tb_stockopname_dcompany WHERE NoSO = ?',
          [NoSO]
        );

        // Query to get related categories for the current NoSO
        const [categories] = await pool.query(
          'SELECT IdCategory FROM tb_stockopname_dcategory WHERE NoSO = ?',
          [NoSO]
        );

        // Query to get related locations for the current NoSO
        const [locations] = await pool.query(
          'SELECT IdLocation FROM tb_stockopname_dlocation WHERE NoSO = ?',
          [NoSO]
        );

        // Format the result for the current NoSO
        return {
          NoSO,
          Tanggal: formatDate(Tanggal), // Format date if necessary
          companies: companies.map((c) => c.IdCompany),
          categories: categories.map((c) => c.IdCategory),
          locations: locations.map((l) => l.IdLocation),
        };
      })
    );

    // Return the final aggregated data as JSON
    res.json(result);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



// Route to get Stock Opname Number
router.get('/no-stock-opname/nosomax', verifyToken, async (req, res) => {
  try {
    await connectDb();
    
    // Query untuk mendapatkan NoSO terakhir
    const [rows] = await pool.query(`
      SELECT NoSO 
      FROM tb_stockopname_h 
      ORDER BY NoSO DESC 
      LIMIT 1
    `);
    
    if (rows.length === 0) {
      // Jika tidak ada data, bisa mengembalikan nilai default pertama
      return res.json({ nextNoSO: 'SO.00000001' });
    }

    const lastNoSO = rows[0].NoSO;
    
    // Pisahkan prefix dan angka
    const parts = lastNoSO.split('.');
    const prefix = parts[0]; // 'SO'
    const numberStr = parts[1]; // '00000001'
    
    // Konversi ke number, tambahkan 1, lalu format kembali ke 8 digit
    const number = parseInt(numberStr, 10) + 1;
    const nextNumberStr = number.toString().padStart(8, '0');
    
    const nextNoSO = `${prefix}.${nextNumberStr}`;

    res.json({ nextNoSO });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Fetch data asset before
router.get('/no-stock-opname-current/:noso', verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noso } = req.params;
    const limit = 50;
    const offset = parseInt(req.query.offset) || 0;
    const companyQuery = req.query.company;
    const categoryQuery = req.query.category;
    const locationQuery = req.query.location;

    // Base condition - NoSO wajib dan belum discan
    let filterConditions = 'd.NoSO = ? AND h.AssetCode IS NULL';
    const queryParams = [noso];

    // ✅ Filter Company (AssetCode prefix)
    if (companyQuery) {
      const companyList = companyQuery.split(',').map(c => c.trim());
      const companyConditions = companyList.map(() => 
        `SUBSTRING_INDEX(d.AssetCode, '/', 1) = ?`
      ).join(' OR ');
      filterConditions += ` AND (${companyConditions})`;
      queryParams.push(...companyList);
    }

    // ✅ Filter CategoryCode
    if (categoryQuery) {
      const categoryList = categoryQuery.split(',').map(c => c.trim());
      const categoryConditions = categoryList.map(() =>
        `SUBSTRING_INDEX(SUBSTRING_INDEX(d.AssetCode, '/', -2), '-', 1) = ?`
      ).join(' OR ');
      filterConditions += ` AND (${categoryConditions})`;
      queryParams.push(...categoryList);
    }

    // ✅ Filter Location
    if (locationQuery) {
      const locationList = locationQuery.split(',').map(l => l.trim());
      const locationConditions = locationList.map(() =>
        `SUBSTRING_INDEX(SUBSTRING_INDEX(d.AssetCode, '/', 2), '-', -1) = ?`
      ).join(' OR ');
      filterConditions += ` AND (${locationConditions})`;
      queryParams.push(...locationList);
    }

    // Query data dengan LEFT JOIN ke tabel hasil
    const dataQuery = `
      SELECT d.AssetCode, a.AssetName, d.HasNotBeenPrinted, d.Image, s.status, u.username
      FROM tb_stockopname_d d
      LEFT JOIN tb_stockopname_d_hasil h ON d.AssetCode = h.AssetCode AND d.NoSO = h.NoSO
      LEFT JOIN asset a ON d.AssetCode = a.AssetCode
      LEFT JOIN tb_so_status s ON d.id_status = s.id_status
      LEFT JOIN tb_user u ON d.id_user = u.id_user
      WHERE ${filterConditions}
      ORDER BY d.AssetCode DESC
      LIMIT ? OFFSET ?
    `;
    
    const dataParams = [...queryParams, limit, offset];

    // Query total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM tb_stockopname_d d
      LEFT JOIN tb_stockopname_d_hasil h ON d.AssetCode = h.AssetCode AND d.NoSO = h.NoSO
      WHERE ${filterConditions}
    `;

    const [rows] = await pool.query(dataQuery, dataParams);
    const [countResult] = await pool.query(countQuery, queryParams);
    const total = countResult[0]?.total || 0;

    if (rows.length === 0) {
      return res.status(404).json({ 
        message: `Tidak ada data asset yang belum discan untuk NoSO: ${noso}` 
      });
    }

    res.json({
      data: rows,
      total,
      nextOffset: offset + limit,
      hasMore: offset + limit < total
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      message: 'Internal Server Error',
      error: error.message 
    });
  }
});

//UPDATE ASSET DETAIL PADA STOCKOPNAME_D
router.put('/update-stock-opname', verifyToken, async (req, res) => {
  try {
    await connectDb();

    const {
      noSO,
      assetCode,
      image,
      idStatus,
      isUpdateValid
    } = req.body;

    const idUser = req.user.id_user;

    console.log("🟡 ID User dari JWT:", idUser);

    // Validasi input
    if (!noSO || !assetCode) {
      return res.status(400).json({ message: 'NoSO dan AssetCode wajib diisi' });
    }

    let query = '';
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
      values = [
        image ?? null,
        idStatus ?? null,
        idUser,
        noSO,
        assetCode
      ];
    } else {
      // Hapus gambar dari file system jika ada
      const imagePath = path.join(__dirname, '..', 'storage', 'uploads', image);
    
      try {
        // Cek apakah file gambar ada, lalu hapus
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);  // Hapus file
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
      return res.status(404).json({ message: 'Data tidak ditemukan atau tidak berubah' });
    }

    res.json({ message: 'Data berhasil diupdate' });

  } catch (error) {
    console.error('Update error:', error.message);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});






// Route to get Asset data based on NoSO
router.get('/no-stock-opname/:noso', verifyToken, async (req, res) => {
  try {
    await connectDb();

    const { noso } = req.params;
    const limit = 50;
    const offset = parseInt(req.query.offset) || 0;
    const companyQuery = req.query.company;
    const categoryQuery = req.query.category;
    const locationQuery = req.query.location;

    let filterConditions = 'h.NoSO = ?'; // Tambahkan alias 'h'
    const queryParams = [noso];

    // ✅ Filter berdasarkan Company
    if (companyQuery) {
      const companyList = companyQuery.split(',').map(c => c.trim());
      const companyConditions = companyList.map(() =>
        `SUBSTRING_INDEX(h.AssetCode, '/', 1) = ?` // Tambahkan alias 'h'
      ).join(' OR ');
      filterConditions += ` AND (${companyConditions})`;
      queryParams.push(...companyList);
    }

    // ✅ Filter berdasarkan CategoryCode
    if (categoryQuery) {
      const categoryList = categoryQuery.split(',').map(c => c.trim());
      const categoryConditions = categoryList.map(() =>
        `SUBSTRING_INDEX(SUBSTRING_INDEX(h.AssetCode, '/', -2), '-', 1) = ?` // Tambahkan alias 'h'
      ).join(' OR ');
      filterConditions += ` AND (${categoryConditions})`;
      queryParams.push(...categoryList);
    }

    // ✅ Filter berdasarkan Location
    if (locationQuery) {
      const locationList = locationQuery.split(',').map(l => l.trim());
      const locationConditions = locationList.map(() =>
        `SUBSTRING_INDEX(SUBSTRING_INDEX(h.AssetCode, '/', 2), '-', -1) = ?` // Tambahkan alias 'h'
      ).join(' OR ');
      filterConditions += ` AND (${locationConditions})`;
      queryParams.push(...locationList);
    }

    // Query data hasil
    const dataQuery = `
      SELECT h.AssetCode, u.Username, a.AssetName
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
      WHERE ${filterConditions} 
    `;
    const [countResult] = await pool.query(countQuery, queryParams.slice(0, -2));

    const total = countResult[0]?.total || 0;

    if (rows.length === 0) {
      return res.status(404).json({ message: `Tidak ada data asset untuk NoSO: ${noso}` });
    }

    res.json({
      data: rows,
      total,
      nextOffset: offset + limit,
      hasMore: offset + limit < total
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


//CREATE NEW SO
router.post("/no-stock-opname/create", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    console.log("✅ Terhubung ke MySQL server:", pool.config?.host || "Unknown");

    // Data dari body request (tanpa NoSO)
    const { Tanggal, IdCompanies, IdCategories, IdLocations } = req.body;

    // Validasi input
    if (!Tanggal || !IdCompanies || !Array.isArray(IdCompanies) || IdCompanies.length === 0) {
      return res.status(400).json({ 
        message: "Tanggal tidak boleh kosong!" 
      });
    }

    // Mulai transaction
    await pool.query("START TRANSACTION");

    try {
      // 1. Ambil NoSO terakhir
      const [lastSo] = await pool.query(`
        SELECT NoSO 
        FROM tb_stockopname_h 
        ORDER BY NoSO DESC 
        LIMIT 1
      `);

      // 2. Generate NoSO baru
      let newNoSO;
      if (lastSo.length === 0) {
        // Jika tabel kosong, mulai dari SO.0000000001
        newNoSO = "SO.0000000001";
      } else {
        // Ekstrak angka dari NoSO terakhir
        const lastNumber = parseInt(lastSo[0].NoSO.split('.')[1]);
        const nextNumber = lastNumber + 1;
        
        // Format ke 10 digit dengan leading zeros
        newNoSO = `SO.${nextNumber.toString().padStart(10, '0')}`;
      }

      // 3. Insert ke tabel header
      await pool.query(
        `INSERT INTO tb_stockopname_h (NoSO, Tanggal) VALUES (?, ?)`,
        [newNoSO, Tanggal]
      );

      // 4. Insert ke tabel-tabel detail
      const insertDetails = async (tableName, columnName, values) => {
        if (values && values.length > 0) {
          const insertSql = `
            INSERT INTO ${tableName} (NoSO, ${columnName}) 
            VALUES ?
          `;
          const formattedValues = values.map(id => [newNoSO, id]);
          await pool.query(insertSql, [formattedValues]);
        }
      };

      await insertDetails('tb_stockopname_dcompany', 'IdCompany', IdCompanies);
      await insertDetails('tb_stockopname_dcategory', 'IdCategory', IdCategories);
      await insertDetails('tb_stockopname_dlocation', 'IdLocation', IdLocations);

      // 5. Ambil semua AssetCode dari tabel `asset`
      let filterConditions = "WHERE created_at < ? AND status = 'active'";
      const queryParams = [Tanggal];

      if (IdCompanies && IdCompanies.length > 0) {
        const companyConditions = IdCompanies.map(() =>
          `SUBSTRING_INDEX(AssetCode, '/', 1) = ?`
        ).join(' OR ');
        filterConditions += ` AND (${companyConditions})`;
        queryParams.push(...IdCompanies);
      }

      // Filter berdasarkan CategoryCode
      if (IdCategories && IdCategories.length > 0) {
        const categoryConditions = IdCategories.map(() =>
          `SUBSTRING_INDEX(SUBSTRING_INDEX(AssetCode, '/', -2), '-', 1) = ?`
        ).join(' OR ');
        filterConditions += ` AND (${categoryConditions})`;
        queryParams.push(...IdCategories);
      }

      // Filter berdasarkan Location
      if (IdLocations && IdLocations.length > 0) {
        const locationConditions = IdLocations.map(() =>
          `SUBSTRING_INDEX(SUBSTRING_INDEX(AssetCode, '/', 2), '-', -1) = ?`
        ).join(' OR ');
        filterConditions += ` AND (${locationConditions})`;
        queryParams.push(...IdLocations);
      }

      const [assets] = await pool.query(
        `SELECT AssetCode FROM asset ${filterConditions}`,
        queryParams
      );
      
      // console.log('Assets retrieved:', assets);

      // 6. Insert AssetCode ke tabel `tb_stockopname_d`
      if (assets.length > 0) {
        const assetInsertSql = `
          INSERT INTO tb_stockopname_d (NoSO, AssetCode) 
          VALUES ?
        `;
        const assetValues = assets.map(asset => [newNoSO, asset.AssetCode]);
        await pool.query(assetInsertSql, [assetValues]);
        console.log('Data successfully inserted into tb_stockopname_d!');

      }

      // Commit transaction
      await pool.query("COMMIT");

    
      res.status(201).json({ 
        message: `Stock Opname berhasil dibuat!`,
        data: {
          NoSO: newNoSO,
          Tanggal: Tanggal,
          IdCompanies: IdCompanies,
          IdCategories: IdCategories,
          IdLocations: IdLocations
        }
      });

    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("❌ Transaction Error:", error);
      throw error;
    }

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ 
      message: "Internal Server Error", 
      error: error.message 
    });
  }
});


// HAPUS MULTIPLE STOCK OPNAME BERDASARKAN ARRAY NoSO
router.delete("/no-stock-opname/delete", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    console.log("✅ Terhubung ke MySQL server");

    const { NoSO } = req.body;

    if (!NoSO || !Array.isArray(NoSO) || NoSO.length === 0) {
      return res.status(400).json({ message: "NoSO harus berupa array dan tidak boleh kosong!" });
    }

    await pool.query("START TRANSACTION");

    try {
      // Hapus detail di DB
      const deleteDetails = async (tableName) => {
        await pool.query(`DELETE FROM ${tableName} WHERE NoSO IN (?)`, [NoSO]);
      };

      await deleteDetails('tb_stockopname_dcompany');
      await deleteDetails('tb_stockopname_dcategory');
      await deleteDetails('tb_stockopname_dlocation');
      await deleteDetails('tb_stockopname_d');
      await deleteDetails('tb_stockopname_d_hasil');
      await deleteDetails('tb_stockopname_non_assets');

      // Hapus header
      const [result] = await pool.query(`DELETE FROM tb_stockopname_h WHERE NoSO IN (?)`, [NoSO]);
      if (result.affectedRows === 0) {
        await pool.query("ROLLBACK");
        return res.status(404).json({ message: "Tidak ada data Stock Opname yang ditemukan!" });
      }

      const uploadDir = path.join(__dirname, '..', 'storage', 'uploads');

      // HAPUS FILE GAMBAR SESUAI NoSO
      NoSO.forEach(noSO => {
        const safeNoSO = noSO.replace(/\./g, '_'); // SO.000001 => SO_000001
        // Baca semua file di folder upload
        const files = fs.readdirSync(uploadDir);
        files.forEach(file => {
          // Jika file namanya diawali safeNoSO, hapus file tersebut
          if (file.startsWith(safeNoSO + '_')) {
            const filePath = path.join(uploadDir, file);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`File gambar dihapus: ${file}`);
            }
          }
        });
      });

      await pool.query("COMMIT");

      res.status(200).json({ 
        message: `${result.affectedRows} data Stock Opname berhasil dihapus!`,
        data: { deletedNoSO: NoSO }
      });

    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("❌ Transaction Error:", error);
      throw error;
    }

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ 
      message: "Internal Server Error", 
      error: error.message 
    });
  }
});




//ITEM NO ASSET
router.post("/no-asset-stock-opname/create", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    console.log("✅ Terhubung ke MySQL server:", pool.config?.host || "Unknown");

    const { NoSO, image, location_code, non_asset_name, remark } = req.body;

    // Validasi input
    if (!NoSO || !image) {
      return res.status(400).json({
        message: "NoSO dan image tidak boleh kosong!"
      });
    }

    const insertSql = `
      INSERT INTO tb_stockopname_non_assets (NoSO, image, location_code, non_asset_name, remark)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(insertSql, [NoSO, image, location_code, non_asset_name, remark || null]);

    res.status(201).json({
      message: "Data berhasil disimpan ke tb_stockopname_non_assets!",
      data: {
        non_asset_id: result.insertId,
        NoSO,
        image,
        location_code,
        non_asset_name: non_asset_name || null,
        remark: remark || null
      }
    });

  } catch (error) {
    console.error("❌ Error saat menyimpan ke tb_stockopname_non_assets:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message
    });
  }
});


router.get("/no-asset-stock-opname/:noso", async (req, res) => {
  try {
    const { noso } = req.params;

    const pool = await connectDb();
    const [rows] = await pool.query(
      "SELECT * FROM tb_stockopname_non_assets WHERE NoSO = ?",
      [noso]
    );

    res.status(200).json({
      message: `Data dengan noso ${noso} berhasil diambil.`,
      data: rows
    });

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message
    });
  }
});


//DELETE ITEM NO ASSET
router.post("/no-asset-stock-opname/delete", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    const { idAssets } = req.body;

    if (!Array.isArray(idAssets) || idAssets.length === 0) {
      return res.status(400).json({
        message: "idAssets harus berupa array dan tidak boleh kosong!"
      });
    }

    // Query untuk mengambil gambar berdasarkan idAssets
    const getImagesSql = `
      SELECT image FROM tb_stockopname_non_assets WHERE non_asset_id IN (?)
    `;
    const [images] = await pool.query(getImagesSql, [idAssets]);

    // Hapus gambar-gambar dari file system
    images.forEach(image => {
      if (image && image.image) {
        const imagePath = path.join(__dirname, '..', 'storage', 'uploads', image.image);
        // Cek apakah file gambar ada, lalu hapus
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);  // Hapus file
        }
      }
    });

    // Hapus data dari tabel setelah file gambar berhasil dihapus
    const deleteSql = `
      DELETE FROM tb_stockopname_non_assets
      WHERE non_asset_id IN (?)
    `;
    const [result] = await pool.query(deleteSql, [idAssets]);

    res.status(200).json({
      message: `${result.affectedRows} item berhasil dihapus.`,
      deletedCount: result.affectedRows
    });

  } catch (error) {
    console.error("❌ Error saat menghapus data:", error);
    res.status(500).json({
      message: "Gagal menghapus data",
      error: error.message
    });
  }
});



// UPDATE Non ASSET (TANPA NoSO)
router.put("/no-asset-stock-opname/update/:non_asset_id", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb();
    const { non_asset_id } = req.params;
    const { image, location_code, non_asset_name, remark } = req.body;

    // Validasi ID harus ada
    if (!non_asset_id) {
      return res.status(400).json({
        message: "ID non asset harus disertakan!"
      });
    }

    // Validasi minimal image atau remark harus ada
    if (image === undefined && location_code === undefined && non_asset_name === undefined && remark === undefined) {
      return res.status(400).json({
        message: "Minimal image atau non asset name atau remark harus diisi untuk update!"
      });
    }

    // Cek apakah data exist
    const [rows] = await pool.query(
      `SELECT non_asset_id FROM tb_stockopname_non_assets WHERE non_asset_id = ?`,
      [non_asset_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: `Data dengan ID ${non_asset_id} tidak ditemukan!`
      });
    }

    // Update hanya image dan remark
    const updateSql = `
      UPDATE tb_stockopname_non_assets 
      SET 
        image = IFNULL(?, image),
        location_code = ?,
        non_asset_name = ?,
        remark = ?
      WHERE non_asset_id = ?
    `;

    await pool.query(updateSql, [
      image || null,  // Jika image tidak diisi, gunakan nilai yang ada
      location_code || null,
      non_asset_name || null, 
      remark || null, // Jika remark tidak diisi, set ke null
      non_asset_id
    ]);

    // Ambil data terupdate untuk response
    const [updatedData] = await pool.query(
      `SELECT non_asset_id, NoSO, image, non_asset_name, remark 
       FROM tb_stockopname_non_assets 
       WHERE non_asset_id = ?`,
      [non_asset_id]
    );

    res.status(200).json({
      message: "Image dan remark berhasil diupdate!",
      data: updatedData[0]
    });

  } catch (error) {
    console.error("Error updating data:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message
    });
  }
});






//SIMPAN HASIL SCAN KE DATABASE
router.post("/no-stock-opname/:noso", verifyToken, async (req, res) => {
  try {
    const pool = await connectDb(); // Ambil connection pool
    console.log("✅ Terhubung ke MySQL server:", pool.config?.host || "Unknown");

    const { noso } = req.params;
    let { AssetCode } = req.body;
    const Username = req.user?.username ? req.user.username.toUpperCase() : null;
    const idUser = req.user.id_user;  

    console.log("Username dari JWT:", idUser);
    // console.log("AssetCode sebelum diproses:", AssetCode);

    if (!AssetCode || !Username) {
      return res.status(400).json({ message: "AssetCode dan Username wajib diisi" });
    }

    // Cek apakah AssetCode berbentuk URL
    const isUrl = AssetCode.startsWith("http://") || AssetCode.startsWith("https://");

    if (isUrl) {
      console.log("🔍 AssetCode adalah URL, mengambil data dari halaman...");
      const extractedAssetData = await fetchAssetDataFromPage(AssetCode);
    
      if (!extractedAssetData) {
        return res.status(400).json({ message: "Gagal mengambil data Asset dari halaman web." });
      }
    
      AssetCode = extractedAssetData.assetCode; // Ganti dengan hasil scraping AssetCode
      AssetName = extractedAssetData.assetName; // Simpan hasil scraping AssetName
    
    } else {
      return res.status(404).json({ message: "AssetCode tidak terdaftar!" });
    }

    console.log("Final AssetCode yang akan disimpan:", AssetCode);

        // Pengecekan validasi format dan tabel referensi
        const companyCode = AssetCode.split('/')[0];
        const categoryCode = AssetCode.split('/')[1]?.split('-')[0];
        const locationCode = AssetCode.split('/')[1]?.split('-')[1];

        if (!companyCode || !categoryCode || !locationCode) {
          return res.status(400).json({ message: "Format AssetCode tidak valid!" });
        }

    // Validasi terhadap tabel referensi
    const validationQuery = `
    SELECT
      EXISTS (
        SELECT 1
        FROM tb_stockopname_dcompany
        WHERE NoSO = ? AND IdCompany = ?
      ) AS isValidCompany,
      EXISTS (
        SELECT 1
        FROM tb_stockopname_dcategory
        WHERE NoSO = ? AND IdCategory = ?
      ) AS isValidCategory,
      EXISTS (
        SELECT 1
        FROM tb_stockopname_dlocation
        WHERE NoSO = ? AND IdLocation = ?
      ) AS isValidLocation
  `;

  const [validationResult] = await pool.query(validationQuery, [
    noso,
    companyCode,
    noso,
    categoryCode,
    noso,
    locationCode,
  ]);

  const { isValidCompany, isValidCategory, isValidLocation } = validationResult[0];

  if (!isValidCompany || !isValidCategory || !isValidLocation) {
    // console.log("❌ Validasi gagal:", { isValidCompany, isValidCategory, isValidLocation });
  
    const invalidFields = [];
    if (!isValidCompany) invalidFields.push("Company");
    if (!isValidCategory) invalidFields.push("Category");
    if (!isValidLocation) invalidFields.push("Location");
  
    return res.status(409).json({
      message: `${invalidFields.join(', ')} tidak sesuai!`,
      details: {
        isValidCompany,
        isValidCategory,
        isValidLocation,
      },
    });
  }    

    const checkDuplicateSql = `
    SELECT COUNT(*) AS count 
    FROM tb_stockopname_d_hasil 
    WHERE NoSO = ? AND AssetCode = ?
  `;
  
    const [duplicateResult] = await pool.query(checkDuplicateSql, [noso, AssetCode]);
    const isDuplicate = duplicateResult[0].count > 0;

    if (isDuplicate) {
      console.log(`AssetCode ${AssetCode} sudah ada untuk NoSO ${noso}`);
      return res.status(409).json({ 
        message: `Asset ${AssetCode} telah discan sebelumnya!`,
      });
    }



      // Pengecekan data di tb_stockopname_d sebelum insert
      const checkMasterDataSql = `
      SELECT NoSO, AssetCode, HasNotBeenPrinted, Image, id_status, id_user 
      FROM tb_stockopname_d 
      WHERE NoSO = ? AND AssetCode = ?
    `;

    const [masterDataResult] = await pool.query(checkMasterDataSql, [noso, AssetCode]);

    if (masterDataResult.length > 0) {
      const masterData = masterDataResult[0];
      
      // Hapus gambar dari file system jika ada
      if (masterData.Image) {
        const imagePath = path.join(__dirname, '..', 'storage', 'uploads', masterData.Image);
        
        try {
          // Cek apakah file gambar ada, lalu hapus
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);  // Hapus file
            console.log(`✅ File gambar ${masterData.Image} berhasil dihapus`);
          } else {
            console.log(`⚠️ File gambar ${masterData.Image} tidak ditemukan`);
          }
        } catch (err) {
          console.error(`❌ Gagal menghapus file gambar: ${err.message}`);
          // Lanjutkan proses meskipun gagal menghapus file
        }
      }

      // Update data di tb_stockopname_d
      const updateMasterDataSql = `
        UPDATE tb_stockopname_d 
        SET 
          HasNotBeenPrinted = 0,
          Image = NULL,
          id_status = NULL,
          id_user = ""
        WHERE NoSO = ? AND AssetCode = ?
      `;
      
      await pool.query(updateMasterDataSql, [noso, AssetCode]);
      console.log(`✅ Data master untuk AssetCode ${AssetCode} telah diupdate`);
    }


    const sql = `
      INSERT INTO tb_stockopname_d_hasil (NoSO, AssetCode, id_user, DateTimeScan) 
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;

    const [result] = await pool.query(sql, [noso, AssetCode, idUser]);

    res.status(201).json({ message: `Asset ${AssetCode} berhasil ditambahkan!` });
    
    // Broadcast ke semua client yang subscribe ke NoSO ini
    broadcast({
      type: 'NEW_ASSET',
      data: {
        NoSO: noso,
        AssetCode: AssetCode,
        AssetName: AssetName,
        Username: Username, 
        DateTimeScan: new Date().toISOString()
        // Tambahkan field lain yang diperlukan frontend
      }
    });

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});




//Fungsi untuk fetch AssetCode dan AssetName berdasarkan QR Code
async function fetchAssetDataFromPage(url) {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Ambil AssetCode dari elemen yang sesuai
    const assetCode = $("#AssetCodeTable").text().trim() || $("span.asset-code").text().trim();

    // Ambil AssetName dari elemen yang sesuai
    const assetName = $("#AssetNameTable").text().trim() || $("span.asset-name").text().trim();

    if (!assetCode || !assetName) {
      throw new Error("AssetCode atau AssetName tidak ditemukan dalam halaman web.");
    }

    return { assetCode, assetName };
  } catch (error) {
    console.error("❌ Error mengambil data Asset dari halaman:", error.message);
    return null;
  }
}


module.exports = router;
