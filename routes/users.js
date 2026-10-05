var express = require("express");
var router = express.Router();
var multer = require("multer");
var ExcelJS = require("exceljs");
var XLSX = require("xlsx");
const bcrypt = require("bcrypt");

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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("users", { title: "Users Page" });
});

// =========================
// LOOKUPS (IMPORTANT: ABOVE /:id)
// =========================
router.get("/get-branches", async (req, res) => {
  try {
    const branches = await Select(`
      SELECT id, branch_name
      FROM branches
      ORDER BY branch_name ASC
    `);

    res.json(branches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch branches" });
  }
});

router.get("/get-roles", async (req, res) => {
  try {
    const roles = await Select(`
      SELECT id, role_name
      FROM roles
      ORDER BY role_name ASC
    `);

    res.json(roles);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch roles" });
  }
});

// =========================
// GET USERS — paginated + searchable
// =========================
// Query params: page (default 1), limit (default 4), search (optional)
router.get("/get-users", async (req, res) => {
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
      whereSql = `
        WHERE u.first_name LIKE ?
           OR u.last_name LIKE ?
           OR u.email LIKE ?
           OR u.username LIKE ?
           OR b.branch_name LIKE ?
           OR r.role_name LIKE ?
      `;
      const term = `%${search}%`;
      params = [term, term, term, term, term, term];
    }

    const countSql = `
      SELECT COUNT(*) AS total
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN roles r ON r.id = u.role_id
      ${whereSql}
    `;
    const countResult = await Select(countSql, params);
    const total = countResult[0]?.total || 0;

    const dataSql = `
      SELECT
        u.id,
        u.branch_id,
        u.role_id,
        u.first_name,
        u.last_name,
        u.email,
        u.username,
        u.is_active,
        b.branch_name,
        r.role_name
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN roles r ON r.id = u.role_id
      ${whereSql}
      ORDER BY u.id DESC
      LIMIT ? OFFSET ?
    `;
    const users = await Select(dataSql, [...params, limit, offset]);

    res.json({
      data: users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("[users] Failed to load users", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// =========================
// CREATE USER
// =========================
router.post("/", async (req, res) => {
  try {
    const {
      branch_id,
      role_id,
      first_name,
      last_name,
      email,
      username,
      password,
    } = req.body;

    if (
      !branch_id ||
      !role_id ||
      !first_name ||
      !last_name ||
      !email ||
      !username ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing Required Fields",
      });
    }

    const emailResult = await Select(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email],
    );

    if (emailResult.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${email} already exists`,
      });
    }

    const usernameResult = await Select(
      "SELECT id FROM users WHERE username = ? LIMIT 1",
      [username],
    );

    if (usernameResult.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${username} already exists`,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO users (
        branch_id,
        role_id,
        first_name,
        last_name,
        email,
        username,
        password,
        is_active,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      branch_id,
      role_id,
      first_name,
      last_name,
      email,
      username,
      hashedPassword,
      1,
      new Date(),
    ];

    await Insert(sql, values);

    return res.status(201).json({
      success: true,
      message: "User successfully created",
    });
  } catch (err) {
    console.error("CREATE USER ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to create user",
    });
  }
});

// =========================
// EXPORT EXCEL — server-side, styled, exports ALL users (not just the
// current page, since the table only renders a fixed page size now)
// =========================
router.get("/export-excel", async (req, res) => {
  try {
    const users = await Select(`
      SELECT
        u.id, u.first_name, u.last_name, u.email, u.username,
        u.is_active, b.branch_name, r.role_name
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN roles r ON r.id = u.role_id
      ORDER BY u.id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Users", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    sheet.mergeCells("A1:G1");
    sheet.getCell("A1").value = "User List Report";
    sheet.getCell("A1").font = {
      size: 16,
      bold: true,
      color: { argb: "FF1F2937" },
    };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.mergeCells("A2:G2");
    sheet.getCell("A2").value = `Generated on ${new Date().toLocaleString()}`;
    sheet.getCell("A2").font = {
      size: 10,
      italic: true,
      color: { argb: "FF6B7280" },
    };
    sheet.getCell("A2").alignment = { horizontal: "center" };

    sheet.mergeCells("A3:G3");
    sheet.getCell("A3").value = `Total Users: ${users.length}`;
    sheet.getCell("A3").font = { size: 10, bold: true };
    sheet.getCell("A3").alignment = { horizontal: "center" };

    const headerRow = sheet.getRow(4);
    headerRow.values = [
      "ID",
      "First Name",
      "Last Name",
      "Email",
      "Username",
      "Branch",
      "Role",
      "Status",
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

    users.forEach((u, i) => {
      const row = sheet.addRow([
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.username,
        u.branch_name || "-",
        u.role_name || "-",
        u.is_active == 1 ? "Active" : "Inactive",
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
      { width: 20 },
      { width: 20 },
      { width: 28 },
      { width: 18 },
      { width: 22 },
      { width: 16 },
      { width: 12 },
    ];
    sheet.autoFilter = { from: "A4", to: "H4" };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=users.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[users] EXPORT EXCEL ERROR:", err);
    res.status(500).json({ message: "Failed to export users" });
  }
});

// =========================
// DOWNLOAD BULK UPLOAD TEMPLATE — styled .xlsx
// =========================
router.get("/download-template", async (req, res) => {
  try {
    const [branches, roles] = await Promise.all([
      Select("SELECT branch_name FROM branches ORDER BY branch_name ASC"),
      Select("SELECT role_name FROM roles ORDER BY role_name ASC"),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Users", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "first_name", key: "first_name", width: 20 },
      { header: "last_name", key: "last_name", width: 20 },
      { header: "email", key: "email", width: 28 },
      { header: "username", key: "username", width: 20 },
      { header: "password", key: "password", width: 20 },
      { header: "branch_name", key: "branch_name", width: 26 },
      { header: "role_name", key: "role_name", width: 18 },
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
      first_name: "Juan",
      last_name: "Dela Cruz",
      email: "juan.delacruz@email.com",
      username: "juan.delacruz",
      password: "TempPass123",
      branch_name: branches[0]?.branch_name || "Main Branch",
      role_name: roles[0]?.role_name || "Staff",
    });
    sampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: "FF999999" } };
    });

    for (let r = 2; r <= 50; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 7; c++) {
        row.getCell(c).border = {
          top: { style: "hair", color: { argb: "FFEEEEEE" } },
          bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
          left: { style: "hair", color: { argb: "FFEEEEEE" } },
          right: { style: "hair", color: { argb: "FFEEEEEE" } },
        };
      }
    }

    // Reference sheet — valid branch and role names, since bulk upload
    // matches these by exact (case-insensitive) name, not ID
    const refSheet = workbook.addWorksheet("Valid Branches & Roles");
    refSheet.columns = [{ width: 30 }, { width: 30 }];
    refSheet.getRow(1).values = ["Branch Name", "Role Name"];
    refSheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF198754" },
      };
    });
    const maxRows = Math.max(branches.length, roles.length);
    for (let i = 0; i < maxRows; i++) {
      refSheet.addRow([
        branches[i]?.branch_name || "",
        roles[i]?.role_name || "",
      ]);
    }

    const infoSheet = workbook.addWorksheet("Instructions");
    infoSheet.columns = [{ width: 95 }];
    infoSheet.addRow(["Bulk Upload Instructions"]).font = {
      bold: true,
      size: 14,
    };
    infoSheet.addRow([]);
    infoSheet.addRow(["1. Fill in one row per user on the 'Users' sheet."]);
    infoSheet.addRow([
      "2. Do not rename or reorder the header row (first_name, last_name, email, username, password, branch_name, role_name).",
    ]);
    infoSheet.addRow(["3. All seven columns are required for every row."]);
    infoSheet.addRow([
      "4. branch_name and role_name must exactly match an existing name — see the 'Valid Branches & Roles' sheet.",
    ]);
    infoSheet.addRow([
      "5. email and username must be unique across the system.",
    ]);
    infoSheet.addRow(["6. password must be at least 8 characters."]);
    infoSheet.addRow([
      "7. Delete the sample row before uploading, or leave it — invalid rows are skipped and listed in the upload report.",
    ]);
    infoSheet.addRow([
      "8. Save the file and upload it via User Management > Bulk Upload.",
    ]);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=user_upload_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[users] DOWNLOAD TEMPLATE ERROR:", err);
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
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
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

    const normalizeKey = (obj, ...candidates) => {
      for (const c of candidates) {
        const key = Object.keys(obj).find((k) => k.trim().toLowerCase() === c);
        if (key) return obj[key];
      }
      return "";
    };

    const [branches, roles, existingUsers] = await Promise.all([
      Select("SELECT id, branch_name FROM branches"),
      Select("SELECT id, role_name FROM roles"),
      Select("SELECT email, username FROM users"),
    ]);

    const branchMap = new Map(
      branches.map((b) => [b.branch_name.trim().toLowerCase(), b.id]),
    );
    const roleMap = new Map(
      roles.map((r) => [r.role_name.trim().toLowerCase(), r.id]),
    );
    const existingEmails = new Set(
      existingUsers.map((u) => u.email.trim().toLowerCase()),
    );
    const existingUsernames = new Set(
      existingUsers.map((u) => u.username.trim().toLowerCase()),
    );
    const seenEmails = new Set();
    const seenUsernames = new Set();

    const toInsert = [];
    const report = { total: rows.length, success: 0, failed: 0, errors: [] };

    for (let idx = 0; idx < rows.length; idx++) {
      const raw = rows[idx];
      const rowNum = idx + 2;

      const first_name = String(
        normalizeKey(raw, "first_name", "first name"),
      ).trim();
      const last_name = String(
        normalizeKey(raw, "last_name", "last name"),
      ).trim();
      const email = String(normalizeKey(raw, "email")).trim();
      const username = String(normalizeKey(raw, "username")).trim();
      const password = String(normalizeKey(raw, "password")).trim();
      const branch_name = String(
        normalizeKey(raw, "branch_name", "branch"),
      ).trim();
      const role_name = String(normalizeKey(raw, "role_name", "role")).trim();

      const rowErrors = [];

      if (!first_name) rowErrors.push("First name is required.");
      if (!last_name) rowErrors.push("Last name is required.");
      if (!email) {
        rowErrors.push("Email is required.");
      } else if (!emailRegex.test(email)) {
        rowErrors.push("Email is invalid.");
      }
      if (!username) rowErrors.push("Username is required.");
      if (!password) {
        rowErrors.push("Password is required.");
      } else if (password.length < 8) {
        rowErrors.push("Password must be at least 8 characters.");
      }

      const branchKey = branch_name.toLowerCase();
      const roleKey = role_name.toLowerCase();

      if (!branch_name) {
        rowErrors.push("Branch is required.");
      } else if (!branchMap.has(branchKey)) {
        rowErrors.push(`Branch "${branch_name}" was not found.`);
      }

      if (!role_name) {
        rowErrors.push("Role is required.");
      } else if (!roleMap.has(roleKey)) {
        rowErrors.push(`Role "${role_name}" was not found.`);
      }

      const emailKey = email.toLowerCase();
      const usernameKey = username.toLowerCase();

      if (email && existingEmails.has(emailKey)) {
        rowErrors.push(`Email "${email}" already exists.`);
      } else if (email && seenEmails.has(emailKey)) {
        rowErrors.push(`Email "${email}" is duplicated within the file.`);
      }

      if (username && existingUsernames.has(usernameKey)) {
        rowErrors.push(`Username "${username}" already exists.`);
      } else if (username && seenUsernames.has(usernameKey)) {
        rowErrors.push(`Username "${username}" is duplicated within the file.`);
      }

      if (rowErrors.length > 0) {
        report.failed++;
        report.errors.push({ row: rowNum, message: rowErrors.join(" ") });
        continue;
      }

      seenEmails.add(emailKey);
      seenUsernames.add(usernameKey);

      toInsert.push({
        first_name,
        last_name,
        email,
        username,
        password,
        branch_id: branchMap.get(branchKey),
        role_id: roleMap.get(roleKey),
      });
    }

    for (const u of toInsert) {
      const hashedPassword = await bcrypt.hash(u.password, 10);

      await Insert(
        `INSERT INTO users
          (branch_id, role_id, first_name, last_name, email, username, password, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          u.branch_id,
          u.role_id,
          u.first_name,
          u.last_name,
          u.email,
          u.username,
          hashedPassword,
          1,
          new Date(),
        ],
      );
      report.success++;
    }

    res.json({
      message: `${report.success} of ${report.total} users imported successfully.`,
      report,
    });
  } catch (err) {
    console.error("[users] BULK UPLOAD ERROR:", err);
    res.status(500).json({ message: "Bulk upload failed." });
  }
});

// =========================
// GET SINGLE USER (keep below the static routes above)
// =========================
router.get("/:id", async (req, res) => {
  try {
    const rows = await Select("SELECT * FROM users WHERE id = ?", [
      req.params.id,
    ]);

    if (!rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

// =========================
// UPDATE USER
// =========================
router.put("/:id", async (req, res) => {
  try {
    const { branch_id, role_id, first_name, last_name, email, username } =
      req.body;

    await Update(
      `
      UPDATE users
      SET branch_id=?, role_id=?, first_name=?, last_name=?, email=?, username=?, updated_at=NOW()
      WHERE id=?
      `,
      [
        branch_id,
        role_id,
        first_name,
        last_name,
        email,
        username,
        req.params.id,
      ],
    );

    res.json({ message: "User updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update user" });
  }
});

// =========================
// DELETE USER
// (kept for API completeness — the Delete button was removed from the
// User Management table in the UI)
// =========================
router.delete("/:id", async (req, res) => {
  try {
    await Delete("DELETE FROM users WHERE id=?", [req.params.id]);
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete user" });
  }
});

module.exports = router;
