var express = require("express");
var router = express.Router();
var multer = require("multer");
var ExcelJS = require("exceljs");

const upload = multer({ storage: multer.memoryStorage() });

const {
  Select,
  Insert,
  Update,
  Delete,
} = require("../repository/dbconnection");

// Columns searched by the `search` query param on get-drivers /
// export-excel.
const SEARCH_COLUMNS = [
  "driver_code",
  "first_name",
  "last_name",
  "mobile_number",
  "license_number",
];

function buildSearchClause(search) {
  if (!search) return { whereClause: "", params: [] };

  const like = `%${search}%`;
  const whereClause = `WHERE ${SEARCH_COLUMNS.map((c) => `${c} LIKE ?`).join(" OR ")}`;
  const params = SEARCH_COLUMNS.map(() => like);

  return { whereClause, params };
}

// =====================================================
// PAGE
// =====================================================
router.get("/", (req, res) => {
  res.render("driverRegistration", { title: "Driver Registration" });
});

// =====================================================
// GET ALL DRIVERS (API) — unpaginated, kept for any other
// consumer that expects the old flat-array shape.
// =====================================================
router.get("/", async (req, res) => {
  try {
    const drivers = await Select(`
      SELECT *
      FROM drivers
      ORDER BY id DESC
    `);

    res.json(drivers);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to fetch drivers" });
  }
});

// =====================================================
// GET DRIVERS (paginated + searchable)
// Response shape: { data, pagination: { page, limit, total, totalPages } }
// Callers that need every record at once (dropdowns, print, the
// user-link check) pass a large `limit` rather than relying on a
// separate unpaginated endpoint.
// =====================================================
router.get("/get-drivers", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 4);
    const search = (req.query.search || "").trim();
    const offset = (page - 1) * limit;

    const { whereClause, params } = buildSearchClause(search);

    const countRows = await Select(
      `SELECT COUNT(*) as total FROM drivers ${whereClause}`,
      params,
    );
    const total = countRows[0]?.total || 0;

    const drivers = await Select(
      `SELECT * FROM drivers ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      data: drivers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to fetch drivers" });
  }
});

// =====================================================
// GET DRIVER BY ID
// =====================================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const rows = await Select(
      `
      SELECT *
      FROM drivers
      WHERE id = ?
      `,
      [id],
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Driver not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("GET DRIVER ERROR:", err);
    res.status(500).json({ message: "Failed to fetch driver details" });
  }
});

// =====================================================
// EXPORT TO EXCEL
// Respects the same `search` filter as the table, so exporting
// after a search only exports the matching rows.
// =====================================================
router.get("/export-excel", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const { whereClause, params } = buildSearchClause(search);

    const drivers = await Select(
      `SELECT * FROM drivers ${whereClause} ORDER BY id DESC`,
      params,
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Drivers");

    sheet.columns = [
      { header: "Driver Code", key: "driver_code", width: 14 },
      { header: "First Name", key: "first_name", width: 16 },
      { header: "Middle Name", key: "middle_name", width: 16 },
      { header: "Last Name", key: "last_name", width: 16 },
      { header: "Mobile Number", key: "mobile_number", width: 16 },
      { header: "Address", key: "address", width: 24 },
      { header: "License Number", key: "license_number", width: 18 },
      { header: "License Type", key: "license_type", width: 16 },
      { header: "License Expiry", key: "license_expiry", width: 14 },
      { header: "Date Hired", key: "date_hired", width: 14 },
      { header: "Attendance Status", key: "attendance_status", width: 16 },
      { header: "Availability Status", key: "availability_status", width: 18 },
      { header: "Status", key: "status", width: 12 },
      {
        header: "Emergency Contact Name",
        key: "emergency_contact_name",
        width: 20,
      },
      {
        header: "Emergency Contact Number",
        key: "emergency_contact_number",
        width: 20,
      },
      { header: "Remarks", key: "remarks", width: 24 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    headerRow.alignment = { vertical: "middle" };

    drivers.forEach((d) => {
      sheet.addRow({
        driver_code: d.driver_code,
        first_name: d.first_name,
        middle_name: d.middle_name,
        last_name: d.last_name,
        mobile_number: d.mobile_number,
        address: d.address,
        license_number: d.license_number,
        license_type: d.license_type,
        license_expiry: d.license_expiry
          ? new Date(d.license_expiry).toLocaleDateString()
          : "",
        date_hired: d.date_hired
          ? new Date(d.date_hired).toLocaleDateString()
          : "",
        attendance_status: d.attendance_status,
        availability_status: d.availability_status,
        status: d.is_active == 1 ? "Active" : "Inactive",
        emergency_contact_name: d.emergency_contact_name,
        emergency_contact_number: d.emergency_contact_number,
        remarks: d.remarks,
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=drivers-${Date.now()}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to export drivers" });
  }
});

// =====================================================
// DOWNLOAD BULK UPLOAD TEMPLATE
// Column order here MUST match the order read in /bulk-upload
// below (by index, not header text).
// =====================================================
router.get("/download-template", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Driver Template");

    sheet.columns = [
      { header: "First Name*", key: "first_name", width: 16 },
      { header: "Middle Name", key: "middle_name", width: 16 },
      { header: "Last Name*", key: "last_name", width: 16 },
      { header: "Mobile Number*", key: "mobile_number", width: 16 },
      { header: "Address", key: "address", width: 24 },
      { header: "License Number*", key: "license_number", width: 18 },
      {
        header: "License Type (Professional/Non-Professional)*",
        key: "license_type",
        width: 32,
      },
      {
        header: "License Expiry (YYYY-MM-DD)",
        key: "license_expiry",
        width: 20,
      },
      { header: "Date Hired (YYYY-MM-DD)", key: "date_hired", width: 18 },
      { header: "Attendance Status", key: "attendance_status", width: 16 },
      {
        header: "Emergency Contact Name",
        key: "emergency_contact_name",
        width: 20,
      },
      {
        header: "Emergency Contact Number",
        key: "emergency_contact_number",
        width: 20,
      },
      { header: "Remarks", key: "remarks", width: 24 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    headerRow.alignment = { vertical: "middle" };

    // Sample row to show the expected formatting — the report tells
    // uploaders to remove/overwrite it.
    sheet.addRow({
      first_name: "Juan",
      middle_name: "Santos",
      last_name: "Dela Cruz",
      mobile_number: "09171234567",
      address: "123 Sample St, Quezon City",
      license_number: "N01-23-456789",
      license_type: "Professional",
      license_expiry: "2027-01-01",
      date_hired: "2026-01-01",
      attendance_status: "Present",
      emergency_contact_name: "Maria Dela Cruz",
      emergency_contact_number: "09179876543",
      remarks: "Sample row - delete before uploading",
    });
    sheet.getRow(2).font = { italic: true, color: { argb: "FF9CA3AF" } };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=driver-upload-template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to generate template" });
  }
});

// =====================================================
// BULK UPLOAD
// Reads the uploaded workbook row-by-row (skipping the header and
// the sample row's obvious placeholder text isn't special-cased —
// uploaders are told to remove it), validates required fields, and
// inserts one driver per valid row. Every row is reported on
// individually so partial success is visible.
// =====================================================
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded." });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      return res.status(400).json({ message: "Uploaded file has no sheets." });
    }

    const report = { total: 0, success: 0, failed: 0, errors: [] };
    const dataRows = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header row
      // Skip fully blank rows (trailing empty rows are common in xlsx).
      if (row.actualCellCount === 0) return;
      dataRows.push({ rowNumber, row });
    });

    report.total = dataRows.length;

    const cellText = (row, col) => (row.getCell(col).text || "").trim();

    for (const { rowNumber, row } of dataRows) {
      const first_name = cellText(row, 1);
      const middle_name = cellText(row, 2);
      const last_name = cellText(row, 3);
      const mobile_number = cellText(row, 4);
      const address = cellText(row, 5);
      const license_number = cellText(row, 6);
      const license_type = cellText(row, 7);
      const license_expiry = cellText(row, 8);
      const date_hired = cellText(row, 9);
      const attendance_status = cellText(row, 10) || "Present";
      const emergency_contact_name = cellText(row, 11);
      const emergency_contact_number = cellText(row, 12);
      const remarks = cellText(row, 13);

      if (!first_name || !last_name || !mobile_number || !license_number) {
        report.failed++;
        report.errors.push({
          row: rowNumber,
          message:
            "Missing a required field (first name, last name, mobile number, or license number).",
        });
        continue;
      }

      try {
        const latestDriver = await Select(
          `SELECT id FROM drivers ORDER BY id DESC LIMIT 1`,
        );
        const nextId = latestDriver.length ? latestDriver[0].id + 1 : 1;
        const driver_code = `DRV-${String(nextId).padStart(4, "0")}`;

        await Insert(
          `INSERT INTO drivers (
            driver_code, first_name, middle_name, last_name, mobile_number,
            address, license_number, license_type, license_expiry, date_hired,
            attendance_status, availability_status, emergency_contact_name,
            emergency_contact_number, remarks, is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            driver_code,
            first_name,
            middle_name,
            last_name,
            mobile_number,
            address,
            license_number,
            license_type,
            license_expiry || null,
            date_hired || null,
            attendance_status,
            "Available",
            emergency_contact_name,
            emergency_contact_number,
            remarks,
            1,
          ],
        );

        report.success++;
      } catch (rowErr) {
        console.log(
          `[driverRegistration] Bulk upload row ${rowNumber} failed:`,
          rowErr,
        );
        report.failed++;
        report.errors.push({
          row: rowNumber,
          message: "Failed to save this row.",
        });
      }
    }

    res.json({
      message: `${report.success} of ${report.total} driver(s) imported.`,
      report,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Bulk upload failed." });
  }
});

// =====================================================
// CREATE DRIVER
// Stores user_id, linking this driver record back to the users row
// it was created from (via the "Select Driver from Users" dropdown
// on the Add Driver form). availability_status is never trusted
// from the client — every newly created driver is hardcoded to
// "Available" here. A user account can only ever be linked to ONE
// driver record; enforced here server-side even though the
// frontend dropdown already filters accordingly.
// =====================================================
router.post("/", async (req, res) => {
  try {
    const {
      user_id,
      first_name,
      last_name,
      middle_name,
      mobile_number,
      license_number,
      license_type,
      license_expiry,
      date_hired,
      address,
      attendance_status,
      emergency_contact_name,
      emergency_contact_number,
      remarks,
      is_active,
      created_by,
    } = req.body;

    console.log("\n==============================");
    console.log("POST /driverRegistration (add driver)");
    console.log("==============================");
    console.log("Incoming user_id:", user_id);

    // ============================
    // VALIDATION
    // ============================
    if (!first_name)
      return res.status(400).json({ message: "First name is required." });

    if (!last_name)
      return res.status(400).json({ message: "Last name is required." });

    if (!mobile_number)
      return res.status(400).json({ message: "Mobile number is required." });

    if (!license_number)
      return res.status(400).json({ message: "License number is required." });

    // =====================================
    // VALIDATE: user is not already linked to a driver record
    // =====================================
    if (user_id) {
      const existingDriverForUser = await Select(
        `
        SELECT id, driver_code
        FROM drivers
        WHERE user_id = ?
        `,
        [user_id],
      );

      if (existingDriverForUser.length > 0) {
        console.warn(
          `[driverRegistration] Rejected: user_id ${user_id} is already linked to driver "${existingDriverForUser[0].driver_code}" (driver id ${existingDriverForUser[0].id})`,
        );

        return res.status(400).json({
          message:
            "This user is already registered as a driver. Please select a different user.",
        });
      }

      console.log(
        `[driverRegistration] user_id ${user_id} is not yet linked to any driver — OK to proceed`,
      );
    }

    // =====================================
    // GENERATE NEXT DRIVER CODE
    // =====================================
    const latestDriver = await Select(`
      SELECT id
      FROM drivers
      ORDER BY id DESC
      LIMIT 1
    `);

    let nextId = 1;

    if (latestDriver.length > 0) {
      nextId = latestDriver[0].id + 1;
    }

    const driver_code = `DRV-${String(nextId).padStart(4, "0")}`;

    console.log("Generated Driver Code:", driver_code);

    // A new driver is always Available — never trusted from the client.
    const DRIVER_AVAILABILITY_ON_CREATE = "Available";

    // =====================================
    // INSERT DRIVER
    // =====================================
    const sql = `
      INSERT INTO drivers (
        driver_code,
        user_id,
        first_name,
        last_name,
        middle_name,
        mobile_number,
        license_number,
        license_type,
        license_expiry,
        date_hired,
        address,
        attendance_status,
        availability_status,
        emergency_contact_name,
        emergency_contact_number,
        remarks,
        is_active,
        created_by,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    await Insert(sql, [
      driver_code,
      user_id || null,
      first_name,
      last_name,
      middle_name,
      mobile_number,
      license_number,
      license_type,
      license_expiry || null,
      date_hired || null,
      address,
      attendance_status || "Present",
      DRIVER_AVAILABILITY_ON_CREATE,
      emergency_contact_name,
      emergency_contact_number,
      remarks,
      is_active ?? 1,
      created_by || null,
    ]);

    console.log("========== DRIVER CREATED ==========");
    console.log({
      driver_code,
      user_id: user_id || null,
      first_name,
      last_name,
      middle_name,
      mobile_number,
      license_number,
      license_type,
      license_expiry,
      date_hired,
      address,
      attendance_status,
      availability_status: DRIVER_AVAILABILITY_ON_CREATE,
      emergency_contact_name,
      emergency_contact_number,
      remarks,
      is_active,
    });
    console.log("====================================");

    res.json({
      message: "Driver added successfully",
      driver_code,
    });
  } catch (err) {
    console.log("========== ADD DRIVER ERROR ==========");
    console.log(err);
    console.log("======================================");

    res.status(500).json({
      message: "Failed to add driver",
    });
  }
});

// =====================================================
// UPDATE DRIVER
// =====================================================
router.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const {
      first_name,
      last_name,
      middle_name,
      mobile_number,
      license_number,
      license_type,
      license_expiry,
      date_hired,
      address,
      attendance_status,
      availability_status,
      emergency_contact_name,
      emergency_contact_number,
      remarks,
      is_active,
    } = req.body;

    // ============================
    // VALIDATION
    // ============================
    if (!id) {
      return res.status(400).json({
        message: "Driver ID is required.",
      });
    }

    if (!first_name) {
      return res.status(400).json({
        message: "First name is required.",
      });
    }

    if (!last_name) {
      return res.status(400).json({
        message: "Last name is required.",
      });
    }

    if (!mobile_number) {
      return res.status(400).json({
        message: "Mobile number is required.",
      });
    }

    if (!license_number) {
      return res.status(400).json({
        message: "License number is required.",
      });
    }

    // ============================
    // UPDATE DRIVER
    // Note: user_id is intentionally NOT editable here — it's set
    // once at creation time and links the driver record back to the
    // user account it came from. If that link ever needs to change,
    // do it as a deliberate separate action, not a silent side
    // effect of an unrelated field edit.
    // ============================
    const sql = `
      UPDATE drivers
      SET
        first_name=?,
        last_name=?,
        middle_name=?,
        mobile_number=?,
        license_number=?,
        license_type=?,
        license_expiry=?,
        date_hired=?,
        address=?,
        attendance_status=?,
        availability_status=?,
        emergency_contact_name=?,
        emergency_contact_number=?,
        remarks=?,
        is_active=?,
        updated_at=NOW()
      WHERE id=?
    `;

    const params = [
      first_name,
      last_name,
      middle_name,
      mobile_number,
      license_number,
      license_type,
      license_expiry || null,
      date_hired || null,
      address,
      attendance_status || "Present",
      availability_status || "Available",
      emergency_contact_name,
      emergency_contact_number,
      remarks,
      is_active,
      id,
    ];

    await Update(sql, params);

    // ============================
    // TERMINAL LOG
    // ============================
    console.log("========== DRIVER UPDATED ==========");
    console.log({
      id,
      first_name,
      last_name,
      middle_name,
      mobile_number,
      license_number,
      license_type,
      license_expiry,
      date_hired,
      address,
      attendance_status,
      availability_status,
      emergency_contact_name,
      emergency_contact_number,
      remarks,
      is_active,
    });
    console.log("====================================");

    res.json({
      message: "Driver updated successfully",
    });
  } catch (err) {
    console.log("========== UPDATE DRIVER ERROR ==========");
    console.log(err);
    console.log("=========================================");

    res.status(500).json({
      message: "Failed to update driver",
    });
  }
});

// =====================================================
// DELETE DRIVER
// Endpoint kept for now even though the delete button has been
// removed from the Driver Management UI — nothing currently calls
// this route from the frontend.
// =====================================================
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;

    await Delete("DELETE FROM drivers WHERE id=?", [id]);

    res.json({ message: "Driver deleted successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to delete driver" });
  }
});

module.exports = router;

// =====================================================
// SHARED HELPERS — exported for other routers (vehicle.js,
// shipmentDispatch) to reuse as the single source of truth for
// changing/reading a driver's availability_status.
//
// Expected usage elsewhere (once those files are wired in):
//   - vehicle.js, when a driver is assigned to a vehicle:
//       setDriverAvailability(driverId, "Assigned")
//   - shipmentDispatch, when a shipment request is created and a
//     driver + vehicle are assigned to it:
//       setDriverAvailability(driverId, "Delivering")
//   - shipmentDispatch, when that delivery is completed/cancelled:
//       setDriverAvailability(driverId, "Available")
// =====================================================

async function setDriverAvailability(driverId, status) {
  console.log(
    `[driverRegistration] setDriverAvailability(driverId=${driverId}, status="${status}")`,
  );

  await Update(
    `UPDATE drivers SET availability_status = ?, updated_at = NOW() WHERE id = ?`,
    [status, driverId],
  );

  console.log(
    `[driverRegistration] -> driver ${driverId} availability_status set to "${status}"`,
  );
}

async function getDriverInfo(driverId) {
  console.log(`[driverRegistration] getDriverInfo(driverId=${driverId})`);

  const rows = await Select(
    `SELECT id, driver_code, first_name, last_name, is_active, attendance_status, availability_status FROM drivers WHERE id = ?`,
    [driverId],
  );

  console.log(
    rows.length
      ? `[driverRegistration] -> found driver ${rows[0].driver_code} (status: ${rows[0].availability_status})`
      : `[driverRegistration] -> no driver found for id ${driverId}`,
  );

  return rows.length ? rows[0] : null;
}

module.exports.setDriverAvailability = setDriverAvailability;
module.exports.getDriverInfo = getDriverInfo;
