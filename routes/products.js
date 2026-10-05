/**
 * routes/products.js
 * -----------------------------------------------------------------------
 * Refactor notes (what changed vs. the original):
 *  - GET /export now generates a styled ExcelJS report (title block,
 *    colored header, zebra rows) instead of a plain SheetJS sheet, to
 *    match the export style used across the rest of the app.
 *  - NEW: GET /download-template — a styled bulk-upload template with a
 *    reference sheet of valid Type/Category names and an Instructions
 *    sheet, matching the pattern used by branch/store/users/etc. The
 *    existing POST /import endpoint (SheetJS-based, matches Type/Category
 *    by name) is unchanged and still the upload target for that template.
 *  - Requires a `barcode` column on `products` (nullable, unique) and
 *    three npm packages: `xlsx` (SheetJS, for reading imports), `exceljs`
 *    (for styled export/template), and `multer`.
 *
 *      ALTER TABLE products ADD COLUMN barcode VARCHAR(64) NULL UNIQUE;
 *
 *    Existing rows can be backfilled with `PROD-<id>` if you want every
 *    row to have a scannable code immediately:
 *
 *      UPDATE products SET barcode = CONCAT('PROD-', id) WHERE barcode IS NULL;
 *
 *    npm install xlsx exceljs multer
 * -----------------------------------------------------------------------
 */

var express = require("express");
var router = express.Router();
const multer = require("multer");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");

// Import files are parsed in memory - these are small inventory sheets,
// not large uploads, so no need to touch disk.
const upload = multer({ storage: multer.memoryStorage() });

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("products", { title: "Inventory Page" });
});

// =========================
// GET TYPES
// =========================
router.get("/get-types", async (req, res) => {
  try {
    const result = await Select(`
      SELECT id, type_name
      FROM types
      WHERE status = 'active'
      ORDER BY type_name ASC
    `);
    res.json(result);
  } catch (err) {
    sendServerError(res, err, "Failed to fetch types");
  }
});

// =========================
// GET CATEGORIES
// =========================
router.get("/get-categories", async (req, res) => {
  try {
    const result = await Select(`
      SELECT id, category_name
      FROM categories
      WHERE status = 'active'
      ORDER BY category_name ASC
    `);
    res.json(result);
  } catch (err) {
    sendServerError(res, err, "Failed to fetch categories");
  }
});

// =========================
// GET PRODUCTS
// =========================
router.get("/get-products", async (req, res) => {
  try {
    const result = await Select(`
      SELECT
        p.id, p.inventory_name, p.type_id, p.category_id,
        p.brand, p.model, p.description, p.barcode, p.status,
        t.type_name, c.category_name
      FROM products p
      LEFT JOIN types t ON t.id = p.type_id
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.id DESC
    `);
    res.json(result);
  } catch (err) {
    sendServerError(res, err, "Failed to fetch products");
  }
});

// =========================
// EXPORT TO EXCEL — server-side, styled
// Placed before "/:id" so the literal path "/export" isn't swallowed by
// the ":id" param route.
// =========================
router.get("/export", async (req, res) => {
  try {
    const rows = await Select(`
      SELECT
        p.id, p.inventory_name, t.type_name, c.category_name,
        p.brand, p.model, p.barcode, p.description, p.status
      FROM products p
      LEFT JOIN types t ON t.id = p.type_id
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Products", { views: [{ state: "frozen", ySplit: 4 }] });

    sheet.mergeCells("A1:I1");
    sheet.getCell("A1").value = "Product List Report";
    sheet.getCell("A1").font = { size: 16, bold: true, color: { argb: "FF1F2937" } };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.mergeCells("A2:I2");
    sheet.getCell("A2").value = `Generated on ${new Date().toLocaleString()}`;
    sheet.getCell("A2").font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
    sheet.getCell("A2").alignment = { horizontal: "center" };

    sheet.mergeCells("A3:I3");
    sheet.getCell("A3").value = `Total Products: ${rows.length}`;
    sheet.getCell("A3").font = { size: 10, bold: true };
    sheet.getCell("A3").alignment = { horizontal: "center" };

    const headerRow = sheet.getRow(4);
    headerRow.values = ["ID", "Product Name", "Type", "Category", "Brand", "Model", "Barcode", "Description", "Status"];
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    });

    rows.forEach((r, i) => {
      const row = sheet.addRow([
        r.id, r.inventory_name, r.type_name || "-", r.category_name || "-",
        r.brand || "-", r.model || "-", r.barcode || "-", r.description || "-", r.status || "-",
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

    sheet.columns = [
      { width: 8 }, { width: 24 }, { width: 16 }, { width: 16 },
      { width: 16 }, { width: 16 }, { width: 16 }, { width: 30 }, { width: 12 },
    ];
    sheet.autoFilter = { from: "A4", to: "I4" };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="products-${Date.now()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    sendServerError(res, err, "Failed to export products");
  }
});

// =========================
// DOWNLOAD BULK UPLOAD TEMPLATE
// Placed before "/:id" for the same reason as /export above.
// =========================
router.get("/download-template", async (req, res) => {
  try {
    const [types, categories] = await Promise.all([
      Select(`SELECT type_name FROM types WHERE status = 'active' ORDER BY type_name ASC`),
      Select(`SELECT category_name FROM categories WHERE status = 'active' ORDER BY category_name ASC`),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Products", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "Product Name", key: "name", width: 28 },
      { header: "Type", key: "type", width: 18 },
      { header: "Category", key: "category", width: 18 },
      { header: "Brand", key: "brand", width: 18 },
      { header: "Model", key: "model", width: 18 },
      { header: "Barcode", key: "barcode", width: 18 },
      { header: "Description", key: "description", width: 40 },
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
      name: "Sample Product",
      type: types[0]?.type_name || "",
      category: categories[0]?.category_name || "",
      brand: "Sample Brand",
      model: "Model X",
      barcode: "",
      description: "",
    });
    sampleRow.eachCell((cell) => { cell.font = { italic: true, color: { argb: "FF999999" } }; });

    for (let r = 2; r <= 50; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 7; c++) {
        row.getCell(c).border = {
          top: { style: "hair", color: { argb: "FFEEEEEE" } }, bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
          left: { style: "hair", color: { argb: "FFEEEEEE" } }, right: { style: "hair", color: { argb: "FFEEEEEE" } },
        };
      }
    }

    const refSheet = workbook.addWorksheet("Valid Types & Categories");
    refSheet.columns = [{ width: 26 }, { width: 26 }];
    refSheet.getRow(1).values = ["Type", "Category"];
    refSheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF198754" } };
    });
    const maxRows = Math.max(types.length, categories.length);
    for (let i = 0; i < maxRows; i++) {
      refSheet.addRow([types[i]?.type_name || "", categories[i]?.category_name || ""]);
    }

    const infoSheet = workbook.addWorksheet("Instructions");
    infoSheet.columns = [{ width: 90 }];
    infoSheet.addRow(["Bulk Upload Instructions"]).font = { bold: true, size: 14 };
    infoSheet.addRow([]);
    infoSheet.addRow(["1. Fill in one row per product on the 'Products' sheet."]);
    infoSheet.addRow(["2. Do not rename or reorder the header row."]);
    infoSheet.addRow(["3. Product Name is required. Type and Category must exactly match a name on 'Valid Types & Categories', or the row is skipped."]);
    infoSheet.addRow(["4. Barcode is optional but must be unique if provided."]);
    infoSheet.addRow(["5. Delete the sample row before uploading, or leave it — rows with an unmatched Type/Category are skipped."]);
    infoSheet.addRow(["6. Save the file and upload it via Product Management > Import."]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=product_upload_template.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    sendServerError(res, err, "Failed to generate template");
  }
});

// =========================
// IMPORT FROM EXCEL/CSV
// Expected columns (case-insensitive header match): Product Name (required),
// Type, Category, Brand, Model, Barcode, Description.
// Type/Category are matched by name against existing active rows; rows
// with an unmatched type or category are skipped and counted.
// =========================
router.post("/import", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

    const [types, categories] = await Promise.all([
      Select(`SELECT id, type_name FROM types WHERE status = 'active'`),
      Select(
        `SELECT id, category_name FROM categories WHERE status = 'active'`,
      ),
    ]);

    const typeByName = new Map(
      types.map((t) => [String(t.type_name).toLowerCase(), t.id]),
    );
    const categoryByName = new Map(
      categories.map((c) => [String(c.category_name).toLowerCase(), c.id]),
    );

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const name = (
        row["Product Name"] ||
        row["product_name"] ||
        row["inventory_name"] ||
        ""
      )
        .toString()
        .trim();
      const typeName = (row["Type"] || "").toString().trim().toLowerCase();
      const categoryName = (row["Category"] || "")
        .toString()
        .trim()
        .toLowerCase();

      const typeId = typeByName.get(typeName);
      const categoryId = categoryByName.get(categoryName);

      if (!name || !typeId || !categoryId) {
        skipped++;
        continue;
      }

      await Insert(
        `
        INSERT INTO products (
          inventory_name, type_id, category_id, brand, model, barcode, description, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          name,
          typeId,
          categoryId,
          (row["Brand"] || "").toString().trim() || null,
          (row["Model"] || "").toString().trim() || null,
          (row["Barcode"] || "").toString().trim() || null,
          (row["Description"] || "").toString().trim() || null,
          "active",
        ],
      );
      imported++;
    }

    res.json({ imported, skipped, total: rows.length });
  } catch (err) {
    sendServerError(res, err, "Failed to import products");
  }
});

// =========================
// LOOKUP BY BARCODE (used by the scan-to-add flow)
// Placed before "/:id" for the same reason as /export above.
// =========================
router.get("/lookup-barcode/:code", async (req, res) => {
  try {
    const result = await Select(
      `
      SELECT p.*, t.type_name, c.category_name
      FROM products p
      LEFT JOIN types t ON t.id = p.type_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.barcode = ?
      LIMIT 1
      `,
      [req.params.code],
    );

    if (!result.length) {
      return res.status(404).json({ message: "No product with that barcode" });
    }

    res.json(result[0]);
  } catch (err) {
    sendServerError(res, err, "Failed to look up barcode");
  }
});

// =========================
// GET SINGLE PRODUCT
// =========================
router.get("/:id", async (req, res) => {
  try {
    const result = await Select(
      `
      SELECT p.*, t.type_name, c.category_name
      FROM products p
      LEFT JOIN types t ON t.id = p.type_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
      `,
      [req.params.id],
    );

    if (!result.length) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(result[0]);
  } catch (err) {
    sendServerError(res, err, "Failed to fetch product");
  }
});

// =========================
// CREATE PRODUCT
// =========================
router.post("/", async (req, res) => {
  try {
    const payload = buildProductPayload(req.body);

    if (!payload.inventory_name || !payload.type_id || !payload.category_id) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    await Insert(
      `
      INSERT INTO products (
        inventory_name, type_id, category_id, brand, model, barcode, description, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        payload.inventory_name,
        payload.type_id,
        payload.category_id,
        payload.brand,
        payload.model,
        payload.barcode,
        payload.description,
        "active",
      ],
    );

    res
      .status(201)
      .json({ success: true, message: "Product created successfully" });
  } catch (err) {
    sendServerError(res, err, "Failed to create product", { success: false });
  }
});

// =========================
// UPDATE PRODUCT
// =========================
router.put("/:id", async (req, res) => {
  try {
    const payload = buildProductPayload(req.body);

    await Update(
      `
      UPDATE products
      SET inventory_name = ?, type_id = ?, category_id = ?, brand = ?,
          model = ?, barcode = ?, description = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [
        payload.inventory_name,
        payload.type_id,
        payload.category_id,
        payload.brand,
        payload.model,
        payload.barcode,
        payload.description,
        req.params.id,
      ],
    );

    res.json({ message: "Product updated successfully" });
  } catch (err) {
    sendServerError(res, err, "Failed to update product");
  }
});

// =========================
// DELETE PRODUCT
// (kept for API completeness — the Delete button was removed from the
// Product Management table in the UI)
// =========================
router.delete("/:id", async (req, res) => {
  try {
    await Delete("DELETE FROM products WHERE id = ?", [req.params.id]);
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    sendServerError(res, err, "Failed to delete product");
  }
});

// =========================
// helpers
// =========================
function buildProductPayload(body) {
  return {
    inventory_name: body.inventory_name,
    type_id: body.type_id,
    category_id: body.category_id,
    brand: body.brand || null,
    model: body.model || null,
    barcode: body.barcode || null,
    description: body.description || null,
  };
}

function sendServerError(res, err, message, extra = {}) {
  console.error(err);
  res.status(500).json({ message, ...extra });
}

module.exports = router;