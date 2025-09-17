const express = require('express');
const verifyToken = require('../middleware/verifyToken'); // Middleware to verify JWT token
const moment = require('moment');
const { pool, connectDb } = require('../../db');  // Import MySQL connection pool
const router = express.Router();
const path = require('path'); // Pastikan path diimpor
const fs = require('fs');
require('moment/locale/id');
moment.locale('id'); // Set ke bahasa Indonesia

// Helper function to format dates using Moment.js
const formatDate = (date) => {
  return moment(date).format('DD MMMM YYYY');
};


//CREATE NEW SO
router.post("/no-stock-opname/create", verifyToken, async (req, res) => {
    try {
      const pool = await connectDb();
      console.log("✅ Terhubung ke MySQL server:", pool.config?.host || "Unknown");
  
      // Data dari body request (tanpa NoSO)
      const { Tanggal, IdCompanies, IdCategories, IdLocations, IsBOM } = req.body;
  
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
          `INSERT INTO tb_stockopname_h (NoSO, Tanggal, IsBOM) VALUES (?, ?, ?)`,
          [newNoSO, Tanggal, IsBOM]
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


        const getIdsFromNames = async (pool, table, idColumn, nameColumn, names) => {
          if (!names || names.length === 0) return [];
        
          const placeholders = names.map(() => '?').join(',');
          const [rows] = await pool.query(
            `SELECT ${idColumn} FROM ${table} WHERE ${nameColumn} IN (${placeholders})`,
            names
          );
          return rows.map(row => row[idColumn]);
        };
        
  
        // Konversi dari nama → ID
        const companyIds = await getIdsFromNames(pool, 'tb_company', 'id_company', 'company_name', IdCompanies);
        const categoryIds = await getIdsFromNames(pool, 'tb_category_asset', 'category_code', 'category_name', IdCategories);
        const locationIds = await getIdsFromNames(pool, 'tb_location_asset', 'location_code', 'location_name', IdLocations);

        // Insert pakai ID-nya
        await insertDetails('tb_stockopname_dcompany', 'IdCompany', companyIds);
        await insertDetails('tb_stockopname_dcategory', 'IdCategory', categoryIds);
        await insertDetails('tb_stockopname_dlocation', 'IdLocation', locationIds);

        // 5. Ambil semua AssetCode dari tabel `asset`
        let filterConditions = "WHERE created_at < ? AND status = 'active'";
        const queryParams = [Tanggal];
  
        // Filter berdasarkan Company
        if (IdCompanies && IdCompanies.length > 0) {
          const companyConditions = IdCompanies.map(() =>
            `CompanyName = ?`
          ).join(' OR ');
          filterConditions += ` AND (${companyConditions})`;
          queryParams.push(...IdCompanies);
        }
  
        // Filter berdasarkan Category
        if (IdCategories && IdCategories.length > 0) {
          const categoryConditions = IdCategories.map(() =>
            `CategoryAsset = ?`
          ).join(' OR ');
          filterConditions += ` AND (${categoryConditions})`;
          queryParams.push(...IdCategories);
        }
  
        // Filter berdasarkan Location
        if (IdLocations && IdLocations.length > 0) {
          const locationConditions = IdLocations.map(() =>
            `LocationAsset = ?`
          ).join(' OR ');
          filterConditions += ` AND (${locationConditions})`;
          queryParams.push(...IdLocations);
        }
  
        const [assets] = await pool.query(
          `SELECT AssetCode FROM asset ${filterConditions}`,
          queryParams
        );
        
  
// 6. Insert AssetCode ke tabel `tb_stockopname_bom`
// 6. Insert AssetCode ke tabel yang sesuai berdasarkan IsBOM
// 6. Insert AssetCode ke tabel yang sesuai berdasarkan IsBOM
if (assets.length > 0) {
  console.log("✅ Nilai IsBOM:", IsBOM);

  if (IsBOM) {
    // IsBOM = true → Insert ke tb_stockopname_bom
    console.log("🔍 IsBOM aktif, ambil semua parts dari tb_parts_bom...");

    // Ambil semua part untuk AssetCode yang ada di assets DAN ada di tb_parts_bom
    const assetCodes = assets.map(asset => asset.AssetCode);
    console.log("📋 AssetCodes dari tabel asset:", assetCodes);

    const [bomAssets] = await pool.query(
      `SELECT AssetCode, id AS IdBOM, qty_on_hand AS Qty, uom 
       FROM tb_parts_bom 
       WHERE AssetCode IN (?)`,
      [assetCodes]
    );

    console.log(`🧾 Parts ditemukan di tb_parts_bom: ${bomAssets.length}`);
    
    if (bomAssets.length > 0) {
      // Log untuk melihat AssetCode mana yang ada di BOM
      const bomAssetCodes = bomAssets.map(item => item.AssetCode);
      const validAssetCodes = [...new Set(bomAssetCodes)]; // Remove duplicates
      console.log("📋 AssetCodes yang ada di kedua tabel:", validAssetCodes);

      // Insert ke tb_stockopname_bom dengan detail parts
      const bomInsertSql = `
        INSERT INTO tb_stockopname_bom (NoSO, AssetCode, IdBOM, Qty, uom) 
        VALUES ?
      `;
      const bomValues = bomAssets.map(item => [
        newNoSO,
        item.AssetCode,
        item.IdBOM,
        item.Qty,
        item.uom
      ]);
      
      console.log("📊 Data yang akan diinsert ke tb_stockopname_bom:", bomValues.length, "records");
      await pool.query(bomInsertSql, [bomValues]);
      console.log(`✅ ${bomAssets.length} parts berhasil diinsert ke tb_stockopname_bom!`);
      
      // Log AssetCode yang tidak ada di tb_parts_bom
      const missingAssetCodes = assetCodes.filter(code => !bomAssetCodes.includes(code));
      if (missingAssetCodes.length > 0) {
        console.log("⚠️ AssetCodes tidak ditemukan di tb_parts_bom:", missingAssetCodes);
      }
    } else {
      console.log('⚠️ Tidak ada parts BOM yang ditemukan untuk assets ini.');
      console.log('💡 Kemungkinan: AssetCode di tabel asset tidak ada yang terdaftar di tb_parts_bom');
    }

  } else {
    // IsBOM = false → Insert ke tb_stockopname_d
    console.log("🔍 IsBOM false, insert assets ke tb_stockopname_d...");

    const detailInsertSql = `
      INSERT INTO tb_stockopname_d (NoSO, AssetCode, HasNotBeenPrinted, Image, id_status, id_user) 
      VALUES ?
    `;
    
    // Prepare values untuk tb_stockopname_d
    const detailValues = assets.map(asset => [
      newNoSO,
      asset.AssetCode,
      0, // HasNotBeenPrinted = 1 (belum dicetak)
      null, // Image = null (belum ada gambar)
      null, // id_status = null (belum ada status)
      null  // id_user = null (atau bisa diisi dengan req.user.id jika ada)
    ]);
    
    await pool.query(detailInsertSql, [detailValues]);
    console.log(`✅ ${assets.length} assets berhasil diinsert ke tb_stockopname_d!`);
  }
} else {
  console.log("⚠️ Tidak ada assets yang ditemukan - skip insert detail");
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
            IdLocations: IdLocations,
            IsBOM: IsBOM,
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


// Route to get Stock Opname Number
router.get('/no-stock-opname', verifyToken, async (req, res) => {
  try {
    // Query the main table to get NoSO and Tanggal
    const [rows] = await pool.query('SELECT NoSO, Tanggal, IsBOM, LockedDate FROM tb_stockopname_h ORDER BY NoSO DESC');

    // If no records are found, return 404 error
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Tidak ada Jadwal Stock Opname saat ini' });
    }

    // Process each NoSO to get related company/category/location NAMES
    const result = await Promise.all(
      rows.map(async (item) => {
        const { NoSO, Tanggal, IsBOM, LockedDate } = item;

        // Query to get related company names
        const [companies] = await pool.query(
          `SELECT c.company_name 
           FROM tb_stockopname_dcompany d
           JOIN tb_company c ON d.IdCompany = c.id_company
           WHERE d.NoSO = ?`,
          [NoSO]
        );

        // Query to get related category names
        const [categories] = await pool.query(
          `SELECT cat.category_name 
           FROM tb_stockopname_dcategory d
           JOIN tb_category_asset cat ON d.IdCategory = cat.category_code
           WHERE d.NoSO = ?`,
          [NoSO]
        );

        // Query to get related location names
        const [locations] = await pool.query(
          `SELECT loc.location_name 
           FROM tb_stockopname_dlocation d
           JOIN tb_location_asset loc ON d.IdLocation = loc.location_code
           WHERE d.NoSO = ?`,
          [NoSO]
        );

        // Return formatted result
        return {
          NoSO,
          Tanggal: formatDate(Tanggal),
          IsBOM: IsBOM,
          LockedDate: LockedDate ? formatDate(LockedDate) : "-",
          companies: companies.map((c) => c.company_name),
          categories: categories.map((c) => c.category_name),
          locations: locations.map((l) => l.location_name),
        };
      })
    );

    res.json(result);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
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
        await deleteDetails('tb_stockopname_bom');
        await deleteDetails('tb_stockopname_d_hasil');
        await deleteDetails('tb_stockopname_non_assets');
        await deleteDetails('tb_stockopname_non_parts');
        await deleteDetails('tb_stockopname_hasil_bom');

  
        // Hapus header
        const [result] = await pool.query(`DELETE FROM tb_stockopname_h WHERE NoSO IN (?)`, [NoSO]);
        if (result.affectedRows === 0) {
          await pool.query("ROLLBACK");
          return res.status(404).json({ message: "Tidak ada data Stock Opname yang ditemukan!" });
        }
  
      const uploadDir = path.join(__dirname, '..', '..', 'storage', 'uploads');
  
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


router.put('/no-stock-opname/:noso/lock', verifyToken, async (req, res) => {
  try {
    const { noso } = req.params;

    // Update LockedDate dengan waktu saat ini
    const updateQuery = `
      UPDATE tb_stockopname_h
      SET LockedDate = CURDATE()
      WHERE NoSO = ?
    `;

    const [result] = await pool.query(updateQuery, [noso]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: `NoSO ${noso} tidak ditemukan.` });
    }

    res.json({ message: `NoSO ${noso} berhasil dikunci.` });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});




  module.exports = router;
