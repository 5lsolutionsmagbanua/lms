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
  res.render("categories", { title: "Category Page" });
});

/* ======================================================
   GET ALL CATEGORIES
   (ERP SAFE: exclude inactive)
====================================================== */
router.get("/get-categories", async (req, res) => {
  try {
    const data = await Select(`
      SELECT *
      FROM categories
      WHERE status != 'inactive'
      ORDER BY id DESC
    `);

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching categories" });
  }
});

/* ======================================================
   SEARCH CATEGORIES (OPTIONAL ERP FEATURE)
====================================================== */
router.get("/search", async (req, res) => {
  try {
    const keyword = req.query.q || "";

    const data = await Select(
      `
      SELECT *
      FROM categories
      WHERE category_name LIKE ?
      AND status != 'inactive'
      ORDER BY id DESC
      `,
      [`%${keyword}%`],
    );

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error searching categories" });
  }
});

/* ======================================================
   GET SINGLE CATEGORY
====================================================== */
router.get("/get-category/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const data = await Select(`SELECT * FROM categories WHERE id = ?`, [id]);

    res.json(data[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching category" });
  }
});

/* ======================================================
   ADD CATEGORY (WITH STATUS SUPPORT)
====================================================== */
router.post("/add-category", async (req, res) => {
  try {
    const { category_name, description, status, created_by } = req.body;

    if (!category_name?.trim()) {
      return res.status(400).json({ message: "Category name is required" });
    }

    await Insert(
      `
      INSERT INTO categories
      (category_name, description, status, created_by)
      VALUES (?, ?, ?, ?)
      `,
      [
        category_name.trim(),
        description || "",
        status || "active",
        created_by || 1,
      ],
    );

    res.json({ message: "Category created successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error adding category" });
  }
});

/* ======================================================
   UPDATE CATEGORY
====================================================== */
router.put("/update-category/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { category_name, description, status } = req.body;

    if (!category_name?.trim()) {
      return res.status(400).json({ message: "Category name is required" });
    }

    await Update(
      `
      UPDATE categories
      SET
        category_name = ?,
        description = ?,
        status = ?
      WHERE id = ?
      `,
      [category_name.trim(), description || "", status || "active", id],
    );

    res.json({ message: "Category updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating category" });
  }
});

/* ======================================================
   DELETE CATEGORY (SOFT DELETE - ERP STANDARD)
   (kept for API completeness — the Delete button was removed from
   the Categories table in the UI)
====================================================== */
router.delete("/delete-category/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await Update(`UPDATE categories SET status = 'inactive' WHERE id = ?`, [
      id,
    ]);

    res.json({ message: "Category deactivated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting category" });
  }
});

/* ======================================================
   EXPORT EXCEL — server-side, styled
====================================================== */
router.get("/export-excel", async (req, res) => {
  try {
    const categories = await Select(`SELECT * FROM categories WHERE status != 'inactive' ORDER BY id DESC`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Categories", { views: [{ state: "frozen", ySplit: 4 }] });

    sheet.mergeCells("A1:D1");
    sheet.getCell("A1").value = "Categories Report";
    sheet.getCell("A1").font = { size: 16, bold: true, color: { argb: "FF1F2937" } };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.mergeCells("A2:D2");
    sheet.getCell("A2").value = `Generated on ${new Date().toLocaleString()}`;
    sheet.getCell("A2").font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
    sheet.getCell("A2").alignment = { horizontal: "center" };

    sheet.mergeCells("A3:D3");
    sheet.getCell("A3").value = `Total Categories: ${categories.length}`;
    sheet.getCell("A3").font = { size: 10, bold: true };
    sheet.getCell("A3").alignment = { horizontal: "center" };

    const headerRow = sheet.getRow(4);
    headerRow.values = ["ID", "Category Name", "Description", "Status"];
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });

    categories.forEach((c, i) => {
      const row = sheet.addRow([c.id, c.category_name, c.description || "-", c.status]);
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

    sheet.columns = [{ width: 8 }, { width: 26 }, { width: 50 }, { width: 12 }];
    sheet.autoFilter = { from: "A4", to: "D4" };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=categories.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT EXCEL ERROR:", err);
    res.status(500).json({ message: "Failed to export categories" });
  }
});

/* ======================================================
   DOWNLOAD BULK UPLOAD TEMPLATE
====================================================== */
router.get("/download-template", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Categories", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "category_name", key: "category_name", width: 28 },
      { header: "description", key: "description", width: 50 },
      { header: "status", key: "status", width: 14 },
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
      category_name: "Sample Category",
      description: "Short description of this category.",
      status: "active",
    });
    sampleRow.eachCell((cell) => { cell.font = { italic: true, color: { argb: "FF999999" } }; });

    for (let r = 2; r <= 50; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 3; c++) {
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
    infoSheet.addRow(["1. Fill in one row per category on the 'Categories' sheet."]);
    infoSheet.addRow(["2. Do not rename or reorder the header row."]);
    infoSheet.addRow(["3. category_name is required."]);
    infoSheet.addRow(["4. status must be 'active' or 'inactive' (blank defaults to 'active')."]);
    infoSheet.addRow(["5. Delete the sample row before uploading, or leave it — invalid rows are skipped and listed in the upload report."]);
    infoSheet.addRow(["6. Save the file and upload it via Categories > Bulk Upload."]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=category_upload_template.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("DOWNLOAD TEMPLATE ERROR:", err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

/* ======================================================
   BULK UPLOAD
====================================================== */
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file was uploaded." });

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

    const existing = await Select("SELECT category_name FROM categories WHERE status != 'inactive'");
    const existingNames = new Set(existing.map((c) => c.category_name.trim().toLowerCase()));
    const seenInFile = new Set();

    const toInsert = [];
    const report = { total: rows.length, success: 0, failed: 0, errors: [] };

    rows.forEach((raw, idx) => {
      const rowNum = idx + 2;
      const category_name = String(normalizeKey(raw, "category_name", "category name")).trim();
      const description = String(normalizeKey(raw, "description")).trim();
      let status = String(normalizeKey(raw, "status")).trim().toLowerCase() || "active";

      const rowErrors = [];
      if (!category_name) rowErrors.push("Category name is required.");
      if (!["active", "inactive"].includes(status)) rowErrors.push("status must be 'active' or 'inactive'.");

      const nameKey = category_name.toLowerCase();
      if (category_name && existingNames.has(nameKey)) rowErrors.push(`Category "${category_name}" already exists.`);
      else if (category_name && seenInFile.has(nameKey)) rowErrors.push(`Category "${category_name}" is duplicated within the file.`);

      if (rowErrors.length) {
        report.failed++;
        report.errors.push({ row: rowNum, message: rowErrors.join(" ") });
        return;
      }

      seenInFile.add(nameKey);
      toInsert.push({ category_name, description, status });
    });

    for (const c of toInsert) {
      await Insert(
        `INSERT INTO categories (category_name, description, status, created_by) VALUES (?, ?, ?, ?)`,
        [c.category_name, c.description, c.status, 1],
      );
      report.success++;
    }

    res.json({ message: `${report.success} of ${report.total} categories imported successfully.`, report });
  } catch (err) {
    console.error("BULK UPLOAD ERROR:", err);
    res.status(500).json({ message: "Bulk upload failed." });
  }
});

module.exports = router;