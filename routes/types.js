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
    if (allowed.includes(file.mimetype) || /\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx, .xls, or .csv files are allowed"));
    }
  },
});

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("types", { title: "Inventory Page" });
});

// =======================
// GET ALL TYPES
// =======================
router.get("/get-types", async (req, res) => {
  try {
    const data = await Select(`
      SELECT *
      FROM types
      ORDER BY id DESC
    `);

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching types" });
  }
});

router.get("/get-type/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const data = await Select(`SELECT * FROM types WHERE id = ?`, [id]);

    res.json(data[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching type" });
  }
});

// =======================
// ADD TYPE
// NOTE: this previously called Select() to run an INSERT statement,
// which happened to work only if your Select() helper doesn't actually
// restrict itself to SELECTs. Switched to the dedicated Insert() helper
// (matches Update()/Delete() below) so this doesn't depend on that.
// =======================
router.post("/add-type", async (req, res) => {
  try {
    const { type_name, description, is_serialized, is_return_required } =
      req.body;

    if (!type_name || !type_name.trim()) {
      return res.status(400).json({ message: "Type name is required" });
    }

    await Insert(
      `
      INSERT INTO types
      (type_name, description, is_serialized, is_return_required, status)
      VALUES (?, ?, ?, ?, 'active')
    `,
      [
        type_name.trim(),
        description || "",
        is_serialized || "no",
        is_return_required || "no",
      ],
    );

    res.json({ message: "Type created successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error adding type" });
  }
});

// =======================
// UPDATE TYPE
// =======================
router.put("/update-type/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      type_name,
      description,
      is_serialized,
      is_return_required,
      status,
    } = req.body;

    await Update(
      `
      UPDATE types
      SET
        type_name = ?,
        description = ?,
        is_serialized = ?,
        is_return_required = ?,
        status = ?
      WHERE id = ?
    `,
      [type_name, description, is_serialized, is_return_required, status, id],
    );

    res.json({ message: "Type updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating type" });
  }
});

// =======================
// DELETE TYPE
// (kept for API completeness — the Delete button was removed from the
// Product Types table in the UI)
// =======================
router.delete("/delete-type/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await Delete(`DELETE FROM types WHERE id = ?`, [id]);

    res.json({ message: "Type deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting type" });
  }
});

// =======================
// EXPORT EXCEL — server-side, styled
// =======================
router.get("/export-excel", async (req, res) => {
  try {
    const types = await Select(`SELECT * FROM types ORDER BY id DESC`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Types", { views: [{ state: "frozen", ySplit: 4 }] });

    sheet.mergeCells("A1:F1");
    sheet.getCell("A1").value = "Product Types Report";
    sheet.getCell("A1").font = { size: 16, bold: true, color: { argb: "FF1F2937" } };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.mergeCells("A2:F2");
    sheet.getCell("A2").value = `Generated on ${new Date().toLocaleString()}`;
    sheet.getCell("A2").font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
    sheet.getCell("A2").alignment = { horizontal: "center" };

    sheet.mergeCells("A3:F3");
    sheet.getCell("A3").value = `Total Types: ${types.length}`;
    sheet.getCell("A3").font = { size: 10, bold: true };
    sheet.getCell("A3").alignment = { horizontal: "center" };

    const headerRow = sheet.getRow(4);
    headerRow.values = ["ID", "Type Name", "Description", "Serialized", "Return Required", "Status"];
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });

    types.forEach((t, i) => {
      const row = sheet.addRow([
        t.id, t.type_name, t.description || "-",
        t.is_serialized, t.is_return_required, t.status,
      ]);
      const isEven = i % 2 === 0;
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isEven ? "FFF3F4F6" : "FFFFFFFF" } };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } }, bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } }, right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
    });

    sheet.columns = [{ width: 8 }, { width: 24 }, { width: 40 }, { width: 14 }, { width: 16 }, { width: 12 }];
    sheet.autoFilter = { from: "A4", to: "F4" };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=product_types.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT EXCEL ERROR:", err);
    res.status(500).json({ message: "Failed to export types" });
  }
});

// =======================
// DOWNLOAD BULK UPLOAD TEMPLATE
// =======================
router.get("/download-template", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Types", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "type_name", key: "type_name", width: 26 },
      { header: "description", key: "description", width: 50 },
      { header: "is_serialized", key: "is_serialized", width: 16 },
      { header: "is_return_required", key: "is_return_required", width: 20 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF198754" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } } };
    });

    const sampleRow = sheet.addRow({
      type_name: "Sample Type",
      description: "Short description of this product type.",
      is_serialized: "no",
      is_return_required: "no",
    });
    sampleRow.eachCell((cell) => { cell.font = { italic: true, color: { argb: "FF999999" } }; });

    for (let r = 2; r <= 50; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 4; c++) {
        row.getCell(c).border = {
          top: { style: "hair", color: { argb: "FFEEEEEE" } }, bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
          left: { style: "hair", color: { argb: "FFEEEEEE" } }, right: { style: "hair", color: { argb: "FFEEEEEE" } },
        };
      }
    }

    const infoSheet = workbook.addWorksheet("Instructions");
    infoSheet.columns = [{ width: 90 }];
    infoSheet.addRow(["Bulk Upload Instructions"]).font = { bold: true, size: 14 };
    infoSheet.addRow([]);
    infoSheet.addRow(["1. Fill in one row per type on the 'Types' sheet."]);
    infoSheet.addRow(["2. Do not rename or reorder the header row."]);
    infoSheet.addRow(["3. type_name is required and must be unique."]);
    infoSheet.addRow(["4. is_serialized and is_return_required must be exactly 'yes' or 'no' (blank defaults to 'no')."]);
    infoSheet.addRow(["5. Delete the sample row before uploading, or leave it — invalid rows are skipped and listed in the upload report."]);
    infoSheet.addRow(["6. Save the file and upload it via Product Types > Bulk Upload."]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=type_upload_template.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("DOWNLOAD TEMPLATE ERROR:", err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

// =======================
// BULK UPLOAD
// =======================
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file was uploaded." });
    }

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
    } catch (e) {
      return res.status(400).json({ message: "Could not read the file. Please check the format." });
    }

    if (!rows.length) return res.status(400).json({ message: "The file has no rows to import." });
    if (rows.length > 1000) return res.status(400).json({ message: "Please limit bulk uploads to 1000 rows at a time." });

    const normalizeKey = (obj, ...candidates) => {
      for (const c of candidates) {
        const key = Object.keys(obj).find((k) => k.trim().toLowerCase() === c);
        if (key) return obj[key];
      }
      return "";
    };

    const existing = await Select("SELECT type_name FROM types");
    const existingNames = new Set(existing.map((t) => t.type_name.trim().toLowerCase()));
    const seenInFile = new Set();

    const toInsert = [];
    const report = { total: rows.length, success: 0, failed: 0, errors: [] };

    rows.forEach((raw, idx) => {
      const rowNum = idx + 2;
      const type_name = String(normalizeKey(raw, "type_name", "type name")).trim();
      const description = String(normalizeKey(raw, "description")).trim();
      let is_serialized = String(normalizeKey(raw, "is_serialized")).trim().toLowerCase() || "no";
      let is_return_required = String(normalizeKey(raw, "is_return_required")).trim().toLowerCase() || "no";

      const rowErrors = [];
      if (!type_name) rowErrors.push("Type name is required.");
      if (!["yes", "no"].includes(is_serialized)) rowErrors.push("is_serialized must be 'yes' or 'no'.");
      if (!["yes", "no"].includes(is_return_required)) rowErrors.push("is_return_required must be 'yes' or 'no'.");

      const nameKey = type_name.toLowerCase();
      if (type_name && existingNames.has(nameKey)) rowErrors.push(`Type "${type_name}" already exists.`);
      else if (type_name && seenInFile.has(nameKey)) rowErrors.push(`Type "${type_name}" is duplicated within the file.`);

      if (rowErrors.length) {
        report.failed++;
        report.errors.push({ row: rowNum, message: rowErrors.join(" ") });
        return;
      }

      seenInFile.add(nameKey);
      toInsert.push({ type_name, description, is_serialized, is_return_required });
    });

    for (const t of toInsert) {
      await Insert(
        `INSERT INTO types (type_name, description, is_serialized, is_return_required, status) VALUES (?, ?, ?, ?, 'active')`,
        [t.type_name, t.description, t.is_serialized, t.is_return_required],
      );
      report.success++;
    }

    res.json({ message: `${report.success} of ${report.total} types imported successfully.`, report });
  } catch (err) {
    console.error("BULK UPLOAD ERROR:", err);
    res.status(500).json({ message: "Bulk upload failed." });
  }
});

module.exports = router;