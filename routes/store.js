var express = require("express");
var router = express.Router();
var multer = require("multer");
var ExcelJS = require("exceljs");
var XLSX = require("xlsx");

const {
  Select,
  Insert,
  Update,
  Delete,
} = require("../repository/dbconnection");

// =========================
// MULTER — in-memory, .xlsx/.xls/.csv only, 5MB cap
// =========================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel", // .xls
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

// =========================
// VALIDATION
// =========================
// Centralized so add-store, update-store, and bulk-upload all enforce
// the exact same rules instead of drifting apart over time.
const RULES = {
  store_name: { min: 3, max: 100, regex: /^[a-zA-Z0-9À-ÿ.,'&()\- ]+$/ },
  store_code: { min: 2, max: 20, regex: /^[A-Z0-9\-]+$/ },
  store_address: { min: 5, max: 255 },
  contact_person: { min: 2, max: 100, regex: /^[a-zA-ZÀ-ÿ.\- ]+$/ },
  contact_number: { regex: /^09\d{9}$/ }, // PH mobile format: 09XXXXXXXXX
};

function validateStore(input) {
  const errors = {};

  const store_name = (input.store_name || "").toString().trim();
  const store_code = (input.store_code || "").toString().trim().toUpperCase();
  const store_address = (input.store_address || "").toString().trim();
  const contact_person = (input.contact_person || "").toString().trim();
  const contact_number = (input.contact_number || "").toString().trim();

  if (!store_name) {
    errors.store_name = "Store name is required.";
  } else if (
    store_name.length < RULES.store_name.min ||
    store_name.length > RULES.store_name.max
  ) {
    errors.store_name = `Store name must be ${RULES.store_name.min}-${RULES.store_name.max} characters.`;
  } else if (!RULES.store_name.regex.test(store_name)) {
    errors.store_name = "Store name contains invalid characters.";
  }

  if (!store_code) {
    errors.store_code = "Store code is required.";
  } else if (
    store_code.length < RULES.store_code.min ||
    store_code.length > RULES.store_code.max
  ) {
    errors.store_code = `Store code must be ${RULES.store_code.min}-${RULES.store_code.max} characters.`;
  } else if (!RULES.store_code.regex.test(store_code)) {
    errors.store_code =
      "Store code may only contain letters, numbers, and dashes.";
  }

  if (!store_address) {
    errors.store_address = "Store address is required.";
  } else if (
    store_address.length < RULES.store_address.min ||
    store_address.length > RULES.store_address.max
  ) {
    errors.store_address = `Store address must be ${RULES.store_address.min}-${RULES.store_address.max} characters.`;
  }

  if (!contact_person) {
    errors.contact_person = "Contact person is required.";
  } else if (
    contact_person.length < RULES.contact_person.min ||
    contact_person.length > RULES.contact_person.max
  ) {
    errors.contact_person = `Contact person must be ${RULES.contact_person.min}-${RULES.contact_person.max} characters.`;
  } else if (!RULES.contact_person.regex.test(contact_person)) {
    errors.contact_person =
      "Contact person may only contain letters and spaces.";
  }

  if (!contact_number) {
    errors.contact_number = "Contact number is required.";
  } else if (!RULES.contact_number.regex.test(contact_number)) {
    errors.contact_number =
      "Contact number must be 11 digits starting with 09 (e.g. 09123456789).";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    clean: {
      store_name,
      store_code,
      store_address,
      contact_person,
      contact_number,
    },
  };
}

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("store", { title: "Store Page" });
});

// =========================
// GET STORES — paginated + searchable
// =========================
// Query params: page (default 1), limit (default 4), search (optional)
router.get("/get-stores", async (req, res) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    const search = (req.query.search || "").toString().trim();

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(limit) || limit < 1) limit = 4;
    limit = Math.min(limit, 100); // hard ceiling so a bad query can't dump the whole table

    const offset = (page - 1) * limit;

    let whereSql = "";
    let params = [];

    if (search) {
      whereSql = `
        WHERE store_name LIKE ?
           OR store_code LIKE ?
           OR store_address LIKE ?
           OR contact_person LIKE ?
           OR contact_number LIKE ?
      `;
      const term = `%${search}%`;
      params = [term, term, term, term, term];
    }

    const countSql = `SELECT COUNT(*) AS total FROM stores ${whereSql}`;
    const countResult = await Select(countSql, params);
    const total = countResult[0]?.total || 0;

    const dataSql = `
      SELECT *
      FROM stores
      ${whereSql}
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `;
    const stores = await Select(dataSql, [...params, limit, offset]);

    res.json({
      data: stores,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("========== GET STORES ERROR ==========");
    console.error(err);
    console.error("======================================");

    res.status(500).json({
      message: "Failed to fetch stores",
    });
  }
});

// =========================
// GET SINGLE STORE (FOR EDIT)
// =========================
router.get("/get-store/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const sql = "SELECT * FROM stores WHERE id = ? LIMIT 1";
    const store = await Select(sql, [id]);

    if (store.length === 0) {
      return res.status(404).json({
        message: "Store not found",
      });
    }

    res.json(store[0]);
  } catch (err) {
    console.error("========== GET STORE ERROR ==========");
    console.error(err);
    console.error("=====================================");

    res.status(500).json({
      message: "Failed to fetch store",
    });
  }
});

// =========================
// ADD STORE
// =========================
router.post("/add-store", async (req, res) => {
  try {
    const check = validateStore(req.body);

    if (!check.valid) {
      return res.status(400).json({
        message: "Please correct the highlighted fields.",
        errors: check.errors,
      });
    }

    const {
      store_name,
      store_code,
      store_address,
      contact_person,
      contact_number,
    } = check.clean;

    const duplicateSql = "SELECT id FROM stores WHERE store_code = ? LIMIT 1";
    const dup = await Select(duplicateSql, [store_code]);

    if (dup.length > 0) {
      return res.status(400).json({
        message: "Store code already exists",
        errors: { store_code: "This store code is already in use." },
      });
    }

    const sql = `
      INSERT INTO stores (
        store_name, store_code, store_address, contact_person,
        contact_number, is_active, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await Insert(sql, [
      store_name,
      store_code,
      store_address,
      contact_person,
      contact_number,
      1,
      new Date(),
    ]);

    return res.json({
      message: "Store created successfully",
    });
  } catch (err) {
    console.error("========== ADD STORE ERROR ==========");
    console.error(err);
    console.error("=====================================");

    res.status(500).json({
      message: "Failed to create store",
    });
  }
});

// =========================
// UPDATE STORE
// =========================
router.put("/update-store/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const check = validateStore(req.body);

    if (!check.valid) {
      return res.status(400).json({
        message: "Please correct the highlighted fields.",
        errors: check.errors,
      });
    }

    const {
      store_name,
      store_code,
      store_address,
      contact_person,
      contact_number,
    } = check.clean;

    // Duplicate check excluding the store being edited
    const duplicateSql =
      "SELECT id FROM stores WHERE store_code = ? AND id != ? LIMIT 1";
    const dup = await Select(duplicateSql, [store_code, id]);

    if (dup.length > 0) {
      return res.status(400).json({
        message: "Store code already exists",
        errors: { store_code: "This store code is already in use." },
      });
    }

    const sql = `
      UPDATE stores
      SET
        store_name = ?,
        store_code = ?,
        store_address = ?,
        contact_person = ?,
        contact_number = ?,
        updated_at = NOW()
      WHERE id = ?
    `;

    await Update(sql, [
      store_name,
      store_code,
      store_address,
      contact_person,
      contact_number,
      id,
    ]);

    res.json({ message: "Store updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update store" });
  }
});

// =========================
// DELETE STORE
// (kept for API completeness — the Delete button was removed from the
// Store Management table in the UI)
// =========================
router.delete("/delete-store/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const sql = "DELETE FROM stores WHERE id = ?";
    const result = await Delete(sql, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Store not found",
      });
    }

    res.json({
      message: "Store deleted successfully",
    });
  } catch (err) {
    console.error("========== DELETE STORE ERROR ==========");
    console.error(err);
    console.error("========================================");

    res.status(500).json({
      message: "Failed to delete store",
    });
  }
});

// =========================
// EXPORT EXCEL — server-side, styled, exports ALL stores
// (not just the current page, since the table only renders 4 rows at a time now)
// =========================
router.get("/export-excel", async (req, res) => {
  try {
    const stores = await Select("SELECT * FROM stores ORDER BY id ASC");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Stores", {
      views: [{ state: "frozen", ySplit: 4 }], // freeze header block while scrolling
    });

    // ---- Title block ----
    sheet.mergeCells("A1:F1");
    sheet.getCell("A1").value = "Store List Report";
    sheet.getCell("A1").font = {
      size: 16,
      bold: true,
      color: { argb: "FF1F2937" },
    };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.mergeCells("A2:F2");
    sheet.getCell("A2").value = `Generated on ${new Date().toLocaleString()}`;
    sheet.getCell("A2").font = {
      size: 10,
      italic: true,
      color: { argb: "FF6B7280" },
    };
    sheet.getCell("A2").alignment = { horizontal: "center" };

    sheet.mergeCells("A3:F3");
    sheet.getCell("A3").value = `Total Stores: ${stores.length}`;
    sheet.getCell("A3").font = { size: 10, bold: true };
    sheet.getCell("A3").alignment = { horizontal: "center" };

    // ---- Header row ----
    const headerRow = sheet.getRow(4);
    headerRow.values = [
      "ID",
      "Store Name",
      "Store Code",
      "Store Address",
      "Contact Person",
      "Contact Number",
    ];
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

    // ---- Data rows ----
    stores.forEach((s, i) => {
      const row = sheet.addRow([
        s.id,
        s.store_name,
        s.store_code,
        s.store_address || "-",
        s.contact_person || "-",
        s.contact_number || "-",
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

    sheet.columns = [
      { width: 8 },
      { width: 28 },
      { width: 16 },
      { width: 36 },
      { width: 24 },
      { width: 18 },
    ];
    sheet.autoFilter = { from: "A4", to: "F4" };

    // ---- Hidden raw-data sheet ----
    // The visible "Stores" sheet above has a title/date block before its
    // header row, which is great for reading but breaks re-parsing (a
    // plain header-row reader sees "Store List Report" as the header).
    // This sheet keeps a clean header-in-row-1 copy with the exact column
    // names bulk-upload expects, so an exported file can be re-imported
    // (e.g. edited elsewhere and brought back in) without manual cleanup.
    const importSheet = workbook.addWorksheet("ImportData", {
      state: "veryHidden",
    });
    importSheet.addRow([
      "store_name",
      "store_code",
      "store_address",
      "contact_person",
      "contact_number",
    ]);
    stores.forEach((s) => {
      importSheet.addRow([
        s.store_name,
        s.store_code,
        s.store_address || "",
        s.contact_person || "",
        s.contact_number || "",
      ]);
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=stores.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("========== EXPORT EXCEL ERROR ==========");
    console.error(err);
    console.error("========================================");

    res.status(500).json({ message: "Failed to export stores" });
  }
});

// =========================
// DOWNLOAD BULK UPLOAD TEMPLATE — styled .xlsx
// =========================
router.get("/download-template", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Stores", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "store_name", key: "store_name", width: 28 },
      { header: "store_code", key: "store_code", width: 16 },
      { header: "store_address", key: "store_address", width: 40 },
      { header: "contact_person", key: "contact_person", width: 24 },
      { header: "contact_number", key: "contact_number", width: 18 },
    ];

    // Style header row to match the bulk-upload modal's success/green theme
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

    // Sample row to illustrate the expected format
    const sampleRow = sheet.addRow({
      store_name: "Sample Store",
      store_code: "STR-001",
      store_address: "123 Sample St, Sample City",
      contact_person: "Juan Dela Cruz",
      contact_number: "09171234567",
    });
    sampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: "FF999999" } };
    });

    // Light borders through a comfortable data-entry area
    for (let r = 2; r <= 50; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 5; c++) {
        row.getCell(c).border = {
          top: { style: "hair", color: { argb: "FFEEEEEE" } },
          bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
          left: { style: "hair", color: { argb: "FFEEEEEE" } },
          right: { style: "hair", color: { argb: "FFEEEEEE" } },
        };
      }
    }

    // Instructions sheet
    const infoSheet = workbook.addWorksheet("Instructions");
    infoSheet.columns = [{ width: 95 }];
    infoSheet.addRow(["Bulk Upload Instructions"]).font = {
      bold: true,
      size: 14,
    };
    infoSheet.addRow([]);
    infoSheet.addRow(["1. Fill in one row per store on the 'Stores' sheet."]);
    infoSheet.addRow([
      "2. Do not rename or reorder the header row (store_name, store_code, store_address, contact_person, contact_number).",
    ]);
    infoSheet.addRow([
      "3. store_name, store_code, store_address, contact_person, and contact_number are all required.",
    ]);
    infoSheet.addRow([
      "4. store_code may only contain letters, numbers, and dashes, and must be unique.",
    ]);
    infoSheet.addRow([
      "5. contact_number must be 11 digits starting with 09 (e.g. 09171234567).",
    ]);
    infoSheet.addRow([
      "6. Delete the sample row before uploading, or leave it — invalid rows are skipped and listed in the upload report.",
    ]);
    infoSheet.addRow([
      "7. Save the file and upload it via Store Management > Bulk Upload.",
    ]);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=store_upload_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("========== DOWNLOAD TEMPLATE ERROR ==========");
    console.error(err);
    console.error("=============================================");

    res.status(500).json({ message: "Failed to generate template" });
  }
});

// =========================
// BULK UPLOAD — parses .xlsx/.xls/.csv, validates every row,
// inserts only the valid ones, returns a per-row report
// =========================
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file was uploaded." });
    }

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      // Files generated by our own /export-excel carry a hidden "ImportData"
      // sheet with clean headers-in-row-1 — use it when present so a
      // round-tripped export (downloaded, maybe edited, re-uploaded) parses
      // correctly instead of tripping over the visible sheet's title block.
      const sheetName = workbook.SheetNames.includes("ImportData")
        ? "ImportData"
        : workbook.SheetNames[0];
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: "",
      });
    } catch (parseErr) {
      return res
        .status(400)
        .json({ message: "Could not read the file. Please check the format." });
    }

    if (!rows || rows.length === 0) {
      return res
        .status(400)
        .json({ message: "The file has no rows to import." });
    }
    if (rows.length > 1000) {
      return res
        .status(400)
        .json({ message: "Please limit bulk uploads to 1000 rows at a time." });
    }

    // Expected headers (case-insensitive match against common variants)
    const normalizeKey = (obj, ...candidates) => {
      for (const c of candidates) {
        const key = Object.keys(obj).find((k) => k.trim().toLowerCase() === c);
        if (key) return obj[key];
      }
      return "";
    };

    const existingCodesResult = await Select("SELECT store_code FROM stores");
    const existingCodes = new Set(
      existingCodesResult.map((r) => r.store_code.toUpperCase()),
    );
    const seenInFile = new Set();

    const toInsert = [];
    const report = { total: rows.length, success: 0, failed: 0, errors: [] };

    rows.forEach((raw, idx) => {
      const rowNum = idx + 2; // +1 for 0-index, +1 for header row
      const candidate = {
        store_name: normalizeKey(raw, "store_name", "store name", "name"),
        store_code: normalizeKey(raw, "store_code", "store code", "code"),
        store_address: normalizeKey(
          raw,
          "store_address",
          "store address",
          "address",
        ),
        contact_person: normalizeKey(raw, "contact_person", "contact person"),
        contact_number: normalizeKey(
          raw,
          "contact_number",
          "contact number",
          "phone",
        ),
      };

      const check = validateStore(candidate);

      if (!check.valid) {
        report.failed++;
        report.errors.push({
          row: rowNum,
          message: Object.values(check.errors).join(" "),
        });
        return;
      }

      const code = check.clean.store_code.toUpperCase();

      if (existingCodes.has(code)) {
        report.failed++;
        report.errors.push({
          row: rowNum,
          message: `Store code "${code}" already exists in the database.`,
        });
        return;
      }
      if (seenInFile.has(code)) {
        report.failed++;
        report.errors.push({
          row: rowNum,
          message: `Store code "${code}" is duplicated within the file.`,
        });
        return;
      }

      seenInFile.add(code);
      toInsert.push(check.clean);
    });

    for (const store of toInsert) {
      await Insert(
        `INSERT INTO stores
          (store_name, store_code, store_address, contact_person, contact_number, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          store.store_name,
          store.store_code,
          store.store_address,
          store.contact_person,
          store.contact_number,
          1,
          new Date(),
        ],
      );
      report.success++;
    }

    res.json({
      message: `${report.success} of ${report.total} stores imported successfully.`,
      report,
    });
  } catch (err) {
    console.error("========== BULK UPLOAD ERROR ==========");
    console.error(err);
    console.error("=======================================");

    res.status(500).json({ message: "Bulk upload failed." });
  }
});

module.exports = router;
