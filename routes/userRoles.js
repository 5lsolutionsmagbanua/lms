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

// ======================================================
// PAGE
// ======================================================
router.get("/", function (req, res) {
  res.render("userRoles", { title: "Roles Management" });
});

// ======================================================
// GET ROLES — paginated + searchable
// ======================================================
// Query params: page (default 1), limit (default 4), search (optional)
router.get("/get-roles", async (req, res) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    const search = (req.query.search || "").toString().trim();

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(limit) || limit < 1) limit = 4;
    limit = Math.min(limit, 100000); // print uses a very high limit intentionally

    const offset = (page - 1) * limit;

    let whereSql = "";
    let params = [];

    if (search) {
      whereSql = `WHERE role_name LIKE ? OR description LIKE ?`;
      const term = `%${search}%`;
      params = [term, term];
    }

    const countSql = `SELECT COUNT(*) AS total FROM roles ${whereSql}`;
    const countResult = await Select(countSql, params);
    const total = countResult[0]?.total || 0;

    const dataSql = `
      SELECT *
      FROM roles
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `;
    const roles = await Select(dataSql, [...params, limit, offset]);

    res.json({
      data: roles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.log("GET ROLES ERROR:", err);
    res.status(500).json({ message: "Failed to fetch roles" });
  }
});

// ======================================================
// ADD ROLE
// ======================================================
router.post("/add-role", async (req, res) => {
  try {
    const { role_name, description } = req.body;

    if (!role_name || !description) {
      return res.status(400).json({
        message: "Role name and description are required",
      });
    }

    const check = await Select(
      "SELECT id FROM roles WHERE role_name = ? LIMIT 1",
      [role_name],
    );

    if (check.length > 0) {
      return res.status(400).json({
        message: "Role already exists",
      });
    }

    const query = `
      INSERT INTO roles (
        role_name,
        description,
        is_active,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `;

    const values = [role_name, description, 1, new Date()];

    await Insert(query, values);

    res.json({
      message: "Role added successfully",
    });
  } catch (err) {
    console.log("ADD ROLE ERROR:", err);
    res.status(500).json({ message: "Failed to add role" });
  }
});

// ======================================================
// UPDATE ROLE
// ======================================================
router.put("/update-role", async (req, res) => {
  try {
    const { id, role_name, description } = req.body;

    if (!id || !role_name || !description) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    const query = `
      UPDATE roles
      SET role_name = ?,
          description = ?
      WHERE id = ?
    `;

    await Update(query, [role_name, description, id]);

    res.json({
      message: "Role updated successfully",
    });
  } catch (err) {
    console.log("UPDATE ROLE ERROR:", err);
    res.status(500).json({ message: "Failed to update role" });
  }
});

// ======================================================
// DELETE ROLE
// (kept for API completeness — no Delete button is exposed in the
// Roles Management table UI)
// ======================================================
router.delete("/delete-role", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        message: "Role ID is required",
      });
    }

    const query = `
      DELETE FROM roles
      WHERE id = ?
    `;

    await Delete(query, [id]);

    res.json({
      message: "Role deleted successfully",
    });
  } catch (err) {
    console.log("DELETE ROLE ERROR:", err);
    res.status(500).json({ message: "Failed to delete role" });
  }
});

// ======================================================
// EXPORT EXCEL — server-side, styled, exports ALL roles
// (not just the current page, since the table only renders a fixed
// page size now)
// ======================================================
router.get("/export-excel", async (req, res) => {
  try {
    const roles = await Select("SELECT * FROM roles ORDER BY id DESC");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Roles", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    sheet.mergeCells("A1:E1");
    sheet.getCell("A1").value = "User Roles Report";
    sheet.getCell("A1").font = { size: 16, bold: true, color: { argb: "FF1F2937" } };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.mergeCells("A2:E2");
    sheet.getCell("A2").value = `Generated on ${new Date().toLocaleString()}`;
    sheet.getCell("A2").font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
    sheet.getCell("A2").alignment = { horizontal: "center" };

    sheet.mergeCells("A3:E3");
    sheet.getCell("A3").value = `Total Roles: ${roles.length}`;
    sheet.getCell("A3").font = { size: 10, bold: true };
    sheet.getCell("A3").alignment = { horizontal: "center" };

    const headerRow = sheet.getRow(4);
    headerRow.values = ["ID", "Role Name", "Description", "Status", "Created At"];
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    roles.forEach((r, i) => {
      const row = sheet.addRow([
        r.id,
        r.role_name,
        r.description || "-",
        r.is_active == 1 ? "Active" : "Inactive",
        r.created_at ? new Date(r.created_at).toLocaleString() : "-",
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
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
    });

    sheet.columns = [
      { width: 8 },
      { width: 22 },
      { width: 40 },
      { width: 14 },
      { width: 20 },
    ];
    sheet.autoFilter = { from: "A4", to: "E4" };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=roles.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXPORT EXCEL ERROR:", err);
    res.status(500).json({ message: "Failed to export roles" });
  }
});

// ======================================================
// DOWNLOAD BULK UPLOAD TEMPLATE — styled .xlsx
// ======================================================
router.get("/download-template", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Roles", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "role_name", key: "role_name", width: 26 },
      { header: "description", key: "description", width: 50 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF198754" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = {
        top: { style: "thin", color: { argb: "FFDDDDDD" } },
        bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
      };
    });

    const sampleRow = sheet.addRow({
      role_name: "Sample Role",
      description: "Short description of what this role can access.",
    });
    sampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: "FF999999" } };
    });

    for (let r = 2; r <= 50; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 2; c++) {
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
    infoSheet.addRow(["Bulk Upload Instructions"]).font = { bold: true, size: 14 };
    infoSheet.addRow([]);
    infoSheet.addRow(["1. Fill in one row per role on the 'Roles' sheet."]);
    infoSheet.addRow(["2. Do not rename or reorder the header row (role_name, description)."]);
    infoSheet.addRow(["3. Both role_name and description are required."]);
    infoSheet.addRow(["4. role_name must be unique — duplicates (in the database or within the file) are skipped."]);
    infoSheet.addRow(["5. Delete the sample row before uploading, or leave it — invalid rows are skipped and listed in the upload report."]);
    infoSheet.addRow(["6. Save the file and upload it via User Roles Management > Bulk Upload."]);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=role_upload_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("DOWNLOAD TEMPLATE ERROR:", err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

// ======================================================
// BULK UPLOAD — parses .xlsx/.xls/.csv, validates every row,
// inserts only the valid ones, returns a per-row report
// ======================================================
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file was uploaded." });
    }

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
        defval: "",
      });
    } catch (parseErr) {
      return res
        .status(400)
        .json({ message: "Could not read the file. Please check the format." });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ message: "The file has no rows to import." });
    }
    if (rows.length > 1000) {
      return res
        .status(400)
        .json({ message: "Please limit bulk uploads to 1000 rows at a time." });
    }

    const normalizeKey = (obj, ...candidates) => {
      for (const c of candidates) {
        const key = Object.keys(obj).find((k) => k.trim().toLowerCase() === c);
        if (key) return obj[key];
      }
      return "";
    };

    const existingRoles = await Select("SELECT role_name FROM roles");
    const existingNames = new Set(
      existingRoles.map((r) => r.role_name.trim().toLowerCase()),
    );
    const seenInFile = new Set();

    const toInsert = [];
    const report = { total: rows.length, success: 0, failed: 0, errors: [] };

    rows.forEach((raw, idx) => {
      const rowNum = idx + 2;

      const role_name = String(
        normalizeKey(raw, "role_name", "role name", "name"),
      ).trim();
      const description = String(
        normalizeKey(raw, "description", "desc"),
      ).trim();

      const rowErrors = [];

      if (!role_name) rowErrors.push("Role name is required.");
      if (!description) rowErrors.push("Description is required.");

      const nameKey = role_name.toLowerCase();

      if (role_name && existingNames.has(nameKey)) {
        rowErrors.push(`Role "${role_name}" already exists.`);
      } else if (role_name && seenInFile.has(nameKey)) {
        rowErrors.push(`Role "${role_name}" is duplicated within the file.`);
      }

      if (rowErrors.length > 0) {
        report.failed++;
        report.errors.push({ row: rowNum, message: rowErrors.join(" ") });
        return;
      }

      seenInFile.add(nameKey);
      toInsert.push({ role_name, description });
    });

    for (const role of toInsert) {
      await Insert(
        `INSERT INTO roles (role_name, description, is_active, created_at)
         VALUES (?, ?, ?, ?)`,
        [role.role_name, role.description, 1, new Date()],
      );
      report.success++;
    }

    res.json({
      message: `${report.success} of ${report.total} roles imported successfully.`,
      report,
    });
  } catch (err) {
    console.error("BULK UPLOAD ERROR:", err);
    res.status(500).json({ message: "Bulk upload failed." });
  }
});

module.exports = router;