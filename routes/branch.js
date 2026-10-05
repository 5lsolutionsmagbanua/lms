var express = require("express");
var router = express.Router();
// adjust based on your DB helper
const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");

// npm install exceljs multer xlsx
const ExcelJS = require("exceljs");
const multer = require("multer");
const xlsx = require("xlsx");

const upload = multer({ storage: multer.memoryStorage() });

const TEMPLATE_HEADERS = [
  "Branch Name",
  "Company Name",
  "Address",
  "Email",
  "Contact Number",
];

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("branch", { title: "Express" });
});

// ======================================================
// GET ALL BRANCHES
// ======================================================
router.get("/get-branches", async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM branches
      ORDER BY id DESC
    `;

    const result = await Select(query);

    res.status(200).json(result);
  } catch (err) {
    console.log("GET BRANCH ERROR:", err);

    res.status(500).json({
      message: "Failed to fetch branches",
    });
  }
});

// ======================================================
// GET SINGLE BRANCH
// ======================================================
router.get("/get-branch/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT *
      FROM branches
      WHERE id = ?
      LIMIT 1
    `;

    const result = await Select(query, [id]);

    if (result.length === 0) {
      return res.status(404).json({
        message: "Branch not found",
      });
    }

    res.json(result[0]);
  } catch (err) {
    console.log("GET BRANCH ERROR:", err);

    res.status(500).json({
      message: "Failed to fetch branch",
    });
  }
});

// ======================================================
// ADD BRANCH
// ======================================================
router.post("/add-branch", async (req, res) => {
  try {
    const { branch_name, company_name, address, email, contact_number } =
      req.body;

    if (!branch_name || !company_name || !address || !contact_number) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    const query = `
      INSERT INTO branches (
        branch_name,
        company_name,
        address,
        email,
        contact_number,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const values = [
      branch_name,
      company_name,
      address,
      email,
      contact_number,
      new Date(),
    ];

    const result = await Insert(query, values);

    res.status(200).json({
      message: "Branch created successfully",
      result,
    });
  } catch (err) {
    console.error("ADD BRANCH ERROR:", err);

    res.status(500).json({
      message: "Failed to add branch",
    });
  }
});

// ======================================================
// UPDATE BRANCH
// ======================================================
router.put("/update-branch", async (req, res) => {
  try {
    const { id, branch_name, company_name, address, email, contact_number } =
      req.body;

    if (!id) {
      return res.status(400).json({ message: "Branch ID is required" });
    }
    if (!branch_name) {
      return res.status(400).json({ message: "Branch Name is required" });
    }
    if (!company_name) {
      return res.status(400).json({ message: "Company Name is required" });
    }
    if (!address) {
      return res.status(400).json({ message: "Address is required" });
    }
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!contact_number) {
      return res.status(400).json({ message: "Contact Number is required" });
    }

    const phoneRegex = /^[0-9]{11}$/;
    if (!phoneRegex.test(contact_number)) {
      return res.status(400).json({
        message: "Contact Number must be exactly 11 digits",
      });
    }

    const query = `
      UPDATE branches
      SET
        branch_name = ?,
        company_name = ?,
        address = ?,
        email = ?,
        contact_number = ?,
        updated_at = NOW()
      WHERE id = ?
    `;

    const values = [
      branch_name,
      company_name,
      address,
      email,
      contact_number,
      id,
    ];

    const result = await Update(query, values);

    res.status(200).json({
      message: "Branch updated successfully",
      result,
    });
  } catch (err) {
    console.error("UPDATE BRANCH ERROR:", err);

    res.status(500).json({
      message: "Failed to update branch",
    });
  }
});

// ======================================================
// DELETE BRANCH
// (kept for API completeness — the delete button was
// removed from the Edit Branch modal in the UI)
// ======================================================
router.delete("/delete-branch", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        message: "Branch ID is required",
      });
    }

    const query = `
      DELETE FROM branches
      WHERE id = ?
    `;

    const result = await Delete(query, [id]);

    res.status(200).json({
      message: "Branch deleted successfully",
      result,
    });
  } catch (err) {
    console.log("DELETE BRANCH ERROR:", err);

    res.status(500).json({
      message: "Failed to delete branch",
    });
  }
});

// ======================================================
// DOWNLOAD BULK UPLOAD TEMPLATE (styled .xlsx)
// ======================================================
router.get("/download-template", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Branch Management";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Branches", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "Branch Name", key: "branch_name", width: 28 },
      { header: "Company Name", key: "company_name", width: 28 },
      { header: "Address", key: "address", width: 40 },
      { header: "Email", key: "email", width: 28 },
      { header: "Contact Number", key: "contact_number", width: 20 },
    ];

    // Style header row
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

    // Sample row to show the expected format
    const sampleRow = sheet.addRow({
      branch_name: "Sample Branch",
      company_name: "Sample Company Inc.",
      address: "123 Sample St, Sample City",
      email: "sample@email.com",
      contact_number: "09171234567",
    });
    sampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: "FF999999" } };
    });

    // Light borders for a clean data-entry area
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
    infoSheet.columns = [{ width: 90 }];
    infoSheet.addRow(["Bulk Upload Instructions"]).font = { bold: true, size: 14 };
    infoSheet.addRow([]);
    infoSheet.addRow(["1. Fill in one row per branch on the 'Branches' sheet."]);
    infoSheet.addRow(["2. Do not rename or reorder the header row."]);
    infoSheet.addRow(["3. Branch Name, Company Name, Address, and Contact Number are required."]);
    infoSheet.addRow(["4. Contact Number must be exactly 11 digits."]);
    infoSheet.addRow(["5. Delete the sample row before uploading, or leave it — rows missing required fields are skipped."]);
    infoSheet.addRow(["6. Save the file and upload it via Branch Management > Bulk Upload."]);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=branch_upload_template.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("DOWNLOAD TEMPLATE ERROR:", err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

// ======================================================
// BULK UPLOAD BRANCHES
// ======================================================
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      return res.status(400).json({ message: "The uploaded file has no data rows" });
    }

    const phoneRegex = /^[0-9]{11}$/;
    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const branch_name = String(row["Branch Name"] || "").trim();
      const company_name = String(row["Company Name"] || "").trim();
      const address = String(row["Address"] || "").trim();
      const email = String(row["Email"] || "").trim() || null;
      const contact_number = String(row["Contact Number"] || "").trim();

      const isValid =
        branch_name &&
        company_name &&
        address &&
        contact_number &&
        phoneRegex.test(contact_number);

      if (!isValid) {
        skipped++;
        continue;
      }

      const query = `
        INSERT INTO branches (
          branch_name,
          company_name,
          address,
          email,
          contact_number,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      await Insert(query, [
        branch_name,
        company_name,
        address,
        email,
        contact_number,
        new Date(),
      ]);

      inserted++;
    }

    res.status(200).json({
      message: `Bulk upload complete: ${inserted} added, ${skipped} skipped.`,
      inserted,
      skipped,
    });
  } catch (err) {
    console.error("BULK UPLOAD ERROR:", err);
    res.status(500).json({ message: "Failed to process bulk upload file" });
  }
});

module.exports = router;