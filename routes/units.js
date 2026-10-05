var express = require("express");
var router = express.Router();
var multer = require("multer");
var ExcelJS = require("exceljs");
var XLSX = require("xlsx");

const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (
      allowed.includes(file.mimetype) ||
      /\.(xlsx|xls|csv)$/i.test(file.originalname)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx, .xls, or .csv files are allowed"));
    }
  },
});

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("units", { title: "Units Page" });
});

/* =====================================================
   GET ALL UNITS
===================================================== */
router.get("/get-units", async (req, res) => {
  try {
    const rows = await Select(`
      SELECT id, unit_name, abbreviation, is_compound
      FROM units
      ORDER BY unit_name ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load units." });
  }
});

/* =====================================================
   SEARCH UNIT
===================================================== */
router.get("/search-unit/:keyword", async (req, res) => {
  try {
    const keyword = `%${req.params.keyword.trim()}%`;

    const rows = await Select(
      `
      SELECT id, unit_name, abbreviation, is_compound
      FROM units
      WHERE unit_name LIKE ? OR abbreviation LIKE ?
      ORDER BY unit_name ASC
      `,
      [keyword, keyword],
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Search failed." });
  }
});

/* =====================================================
   GET SINGLE UNIT
===================================================== */
router.get("/get-unit/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Unit ID." });
    }

    const rows = await Select(`SELECT * FROM units WHERE id=?`, [id]);

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Unit not found." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load unit." });
  }
});

/* =====================================================
   ADD UNIT
===================================================== */
router.post("/add-unit", async (req, res) => {
  try {
    const unit_name = req.body.unit_name?.trim();
    const abbreviation = req.body.abbreviation?.trim().toUpperCase();
    const is_compound = req.body.is_compound?.trim();

    if (!unit_name || !abbreviation || !is_compound) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required." });
    }

    if (!["yes", "no"].includes(is_compound)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid compound value." });
    }

    const duplicate = await Select(
      `SELECT id FROM units WHERE LOWER(unit_name)=LOWER(?) OR LOWER(abbreviation)=LOWER(?)`,
      [unit_name, abbreviation],
    );

    if (duplicate.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Unit already exists." });
    }

    const result = await Insert(
      `INSERT INTO units (unit_name, abbreviation, is_compound) VALUES (?, ?, ?)`,
      [unit_name, abbreviation, is_compound],
    );

    if (result.affectedRows === 0) {
      return res
        .status(500)
        .json({ success: false, message: "Insert failed." });
    }

    res
      .status(201)
      .json({
        success: true,
        message: "Unit added successfully.",
        id: result.insertId,
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to add unit." });
  }
});

/* =====================================================
   UPDATE UNIT
===================================================== */
router.put("/update-unit/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Unit ID." });
    }

    const unit_name = req.body.unit_name?.trim();
    const abbreviation = req.body.abbreviation?.trim().toUpperCase();
    const is_compound = req.body.is_compound?.trim();

    if (!unit_name || !abbreviation || !is_compound) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required." });
    }

    if (!["yes", "no"].includes(is_compound)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid compound value." });
    }

    const duplicate = await Select(
      `SELECT id FROM units WHERE (LOWER(unit_name)=LOWER(?) OR LOWER(abbreviation)=LOWER(?)) AND id<>?`,
      [unit_name, abbreviation, id],
    );

    if (duplicate.length > 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Another unit already uses this name or abbreviation.",
        });
    }

    const result = await Update(
      `UPDATE units SET unit_name=?, abbreviation=?, is_compound=? WHERE id=?`,
      [unit_name, abbreviation, is_compound, id],
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Unit not found." });
    }

    res.json({ success: true, message: "Unit updated successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update unit." });
  }
});

/* =====================================================
   DELETE UNIT
   (kept for API completeness — the Delete button was removed
   from the Units table in the UI)
===================================================== */
router.delete("/delete-unit/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Unit ID." });
    }

    const result = await Delete(`DELETE FROM units WHERE id=?`, [id]);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Unit not found." });
    }

    res.json({ success: true, message: "Unit deleted successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to delete unit." });
  }
});

/* =====================================================
   EXPORT EXCEL — server-side, styled
===================================================== */
router.get("/export-excel", async (req, res) => {
  try {
    const units = await Select(`SELECT * FROM units ORDER BY unit_name ASC`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Units", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    sheet.mergeCells("A1:D1");
    sheet.getCell("A1").value = "Units Report";
    sheet.getCell("A1").font = {
      size: 16,
      bold: true,
      color: { argb: "FF1F2937" },
    };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.mergeCells("A2:D2");
    sheet.getCell("A2").value = `Generated on ${new Date().toLocaleString()}`;
    sheet.getCell("A2").font = {
      size: 10,
      italic: true,
      color: { argb: "FF6B7280" },
    };
    sheet.getCell("A2").alignment = { horizontal: "center" };

    sheet.mergeCells("A3:D3");
    sheet.getCell("A3").value = `Total Units: ${units.length}`;
    sheet.getCell("A3").font = { size: 10, bold: true };
    sheet.getCell("A3").alignment = { horizontal: "center" };

    const headerRow = sheet.getRow(4);
    headerRow.values = ["ID", "Unit Name", "Abbreviation", "Compound Unit"];
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2563EB" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    units.forEach((u, i) => {
      const row = sheet.addRow([
        u.id,
        u.unit_name,
        u.abbreviation,
        u.is_compound === "yes" ? "Compound" : "Single",
      ]);
      const isEven = i % 2 === 0;
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: isEven ? "FFF3F4F6" : "FFFFFFFF" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        };
      });
    });

    sheet.columns = [{ width: 8 }, { width: 26 }, { width: 18 }, { width: 16 }];
    sheet.autoFilter = { from: "A4", to: "D4" };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=units.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT EXCEL ERROR:", err);
    res.status(500).json({ message: "Failed to export units" });
  }
});

/* =====================================================
   DOWNLOAD BULK UPLOAD TEMPLATE
===================================================== */
router.get("/download-template", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Units", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      { header: "unit_name", key: "unit_name", width: 26 },
      { header: "abbreviation", key: "abbreviation", width: 16 },
      { header: "is_compound", key: "is_compound", width: 16 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF198754" },
      };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFDDDDDD" } },
        bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
      };
    });

    const sampleRow = sheet.addRow({
      unit_name: "Box",
      abbreviation: "BOX",
      is_compound: "no",
    });
    sampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: "FF999999" } };
    });

    for (let r = 2; r <= 50; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 3; c++) {
        row.getCell(c).border = {
          top: { style: "hair", color: { argb: "FFEEEEEE" } },
          bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
          left: { style: "hair", color: { argb: "FFEEEEEE" } },
          right: { style: "hair", color: { argb: "FFEEEEEE" } },
        };
      }
    }

    const infoSheet = workbook.addWorksheet("Instructions");
    infoSheet.columns = [{ width: 90 }];
    infoSheet.addRow(["Bulk Upload Instructions"]).font = {
      bold: true,
      size: 14,
    };
    infoSheet.addRow([]);
    infoSheet.addRow(["1. Fill in one row per unit on the 'Units' sheet."]);
    infoSheet.addRow(["2. Do not rename or reorder the header row."]);
    infoSheet.addRow([
      "3. unit_name and abbreviation are required and must both be unique.",
    ]);
    infoSheet.addRow([
      "4. is_compound must be exactly 'yes' or 'no' (blank defaults to 'no').",
    ]);
    infoSheet.addRow([
      "5. Delete the sample row before uploading, or leave it — invalid rows are skipped and listed in the upload report.",
    ]);
    infoSheet.addRow([
      "6. Save the file and upload it via Units > Bulk Upload.",
    ]);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=unit_upload_template.xlsx",
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("DOWNLOAD TEMPLATE ERROR:", err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

/* =====================================================
   BULK UPLOAD
===================================================== */
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "No file was uploaded." });

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
        defval: "",
      });
    } catch (e) {
      return res
        .status(400)
        .json({ message: "Could not read the file. Please check the format." });
    }

    if (!rows.length)
      return res
        .status(400)
        .json({ message: "The file has no rows to import." });
    if (rows.length > 1000)
      return res
        .status(400)
        .json({ message: "Please limit bulk uploads to 1000 rows at a time." });

    const normalizeKey = (obj, ...candidates) => {
      for (const c of candidates) {
        const key = Object.keys(obj).find((k) => k.trim().toLowerCase() === c);
        if (key) return obj[key];
      }
      return "";
    };

    const existing = await Select("SELECT unit_name, abbreviation FROM units");
    const existingNames = new Set(
      existing.map((u) => u.unit_name.trim().toLowerCase()),
    );
    const existingAbbrs = new Set(
      existing.map((u) => u.abbreviation.trim().toLowerCase()),
    );
    const seenNames = new Set();
    const seenAbbrs = new Set();

    const toInsert = [];
    const report = { total: rows.length, success: 0, failed: 0, errors: [] };

    rows.forEach((raw, idx) => {
      const rowNum = idx + 2;
      const unit_name = String(
        normalizeKey(raw, "unit_name", "unit name"),
      ).trim();
      const abbreviation = String(normalizeKey(raw, "abbreviation"))
        .trim()
        .toUpperCase();
      let is_compound =
        String(normalizeKey(raw, "is_compound")).trim().toLowerCase() || "no";

      const rowErrors = [];
      if (!unit_name) rowErrors.push("Unit name is required.");
      if (!abbreviation) rowErrors.push("Abbreviation is required.");
      if (!["yes", "no"].includes(is_compound))
        rowErrors.push("is_compound must be 'yes' or 'no'.");

      const nameKey = unit_name.toLowerCase();
      const abbrKey = abbreviation.toLowerCase();

      if (unit_name && existingNames.has(nameKey))
        rowErrors.push(`Unit name "${unit_name}" already exists.`);
      else if (unit_name && seenNames.has(nameKey))
        rowErrors.push(
          `Unit name "${unit_name}" is duplicated within the file.`,
        );

      if (abbreviation && existingAbbrs.has(abbrKey))
        rowErrors.push(`Abbreviation "${abbreviation}" already exists.`);
      else if (abbreviation && seenAbbrs.has(abbrKey))
        rowErrors.push(
          `Abbreviation "${abbreviation}" is duplicated within the file.`,
        );

      if (rowErrors.length) {
        report.failed++;
        report.errors.push({ row: rowNum, message: rowErrors.join(" ") });
        return;
      }

      seenNames.add(nameKey);
      seenAbbrs.add(abbrKey);
      toInsert.push({ unit_name, abbreviation, is_compound });
    });

    for (const u of toInsert) {
      await Insert(
        `INSERT INTO units (unit_name, abbreviation, is_compound) VALUES (?, ?, ?)`,
        [u.unit_name, u.abbreviation, u.is_compound],
      );
      report.success++;
    }

    res.json({
      message: `${report.success} of ${report.total} units imported successfully.`,
      report,
    });
  } catch (err) {
    console.error("BULK UPLOAD ERROR:", err);
    res.status(500).json({ message: "Bulk upload failed." });
  }
});

module.exports = router;
