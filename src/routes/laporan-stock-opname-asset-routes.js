const express = require("express");
const router = express.Router();
const { connectDb } = require("../../db");
const {
  generateStockOpnameAssetPdf,
} = require("../../services/pdf/report-so-asset/generate-stock-opname-asset-pdf");

router.get("/report/:noso/pdf", async (req, res) => {
  try {
    await connectDb();

    const noSO = req.params.noso;
    const tanggal = req.query.tanggal;
    const lockedDate = req.query.lockeddate || "-";
    const perusahaan = req.query.perusahaan;
    const lokasi = req.query.lokasi;

    res.setHeader("Content-Type", "application/pdf");
    const safeNoSO = noSO.replace(/\./g, "_");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=Laporan_${safeNoSO}.pdf`,
    );

    await generateStockOpnameAssetPdf(res, {
      noSO,
      tanggal,
      lockedDate,
      perusahaan,
      lokasi,
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = router;
