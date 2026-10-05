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

// Reuse the SAME driver-status helpers used by driverRegistration
// (and, per the earlier refactor, meant to also be used by
// shipmentDispatch). This is the actual fix requested here:
// previously this file had its OWN inline UPDATE drivers SET
// availability_status=... statements, completely separate from
// the ones added for shipment assignment. That's how a driver's
// status ends up wrong — two different features independently
// deciding what "Assigned" means, able to stomp on each other
// (e.g. a shipment marks a driver "Assigned", then an unrelated
// vehicle edit overwrites it back to "Available").
// Adjust the path below if your folder structure differs.
const {
  setDriverAvailability,
  getDriverInfo,
} = require("./driverRegistration");

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

/* ============================================================
   VEHICLE ROUTER
   Refactored (reference: driverRegistration.routes.js style).

   WHAT CHANGED AND WHY
   ------------------------------------------------------------
   1. Removed duplicated comment headers (several routes had the
      same "// ===== GET ... =====" block pasted 2-3 times above
      a single handler — cosmetic clutter, cleaned up to one).

   2. All driver availability_status WRITES now go through the
      shared setDriverAvailability() helper from
      driverRegistration.routes.js instead of ad-hoc UPDATE
      statements scattered across this file. This is the same
      single-source-of-truth pattern used for shipment assignment,
      so a vehicle assignment and a shipment assignment can never
      silently overwrite each other's driver status.

   3. Driver validation reads now go through getDriverInfo()
      instead of a locally-written SELECT, for the same reason —
      one place defines what "a valid, available driver" means.

   4. Added consistent console.log tracing on every route, in the
      same "========== LABEL ==========" style used elsewhere.

   5. vehicle.status is decoupled from vehicle.driver_id — see the
      inline notes on the CREATE/UPDATE routes below.

   6. NEW — added /export-excel, /download-template, and
      /bulk-upload, matching the pattern used by branch/store/
      users/userRoles: styled server-side Excel export, a styled
      upload template (with a reference sheet of valid vehicle
      types and available driver codes), and a bulk-upload
      endpoint that validates every row and returns a per-row
      report. Bulk-uploaded vehicles are always created
      "Available" and go through the same driver-validation and
      vehicle-code-generation logic as the single-vehicle CREATE
      route, just looped per row.
   ============================================================ */

// Vehicle statuses that only the shipment dispatch flow may set.
// Everything else ("Available", "Maintenance", "Unavailable") can
// still be set manually from the Edit Vehicle form.
const SYSTEM_MANAGED_VEHICLE_STATUSES = ["Assigned", "In Transit"];
const VALID_VEHICLE_TYPES = ["Truck", "Van", "Motorcycle", "Trailer"];

// =====================================================
// PAGE
// =====================================================
router.get("/", function (req, res) {
  console.log("[vehicle] GET / -> rendering vehicle page");
  res.render("vehicle", { title: "Express" });
});

// =====================================================
// GET AVAILABLE DRIVERS (for the Add/Edit Vehicle dropdown)
// =====================================================
router.get("/drivers/list", async (req, res) => {
  try {
    console.log("[vehicle] GET /drivers/list");

    const rows = await Select(
      `
      SELECT
        id,
        driver_code,
        CONCAT(first_name, ' ', last_name) AS driver_name,
        attendance_status,
        availability_status
      FROM drivers
      WHERE
        is_active = 1
        AND attendance_status = 'Present'
        AND (
          availability_status = 'Available'
          OR availability_status IS NULL
          OR availability_status = ''
        )
      ORDER BY first_name ASC, last_name ASC
      `,
    );

    console.log(`[vehicle] -> ${rows.length} available driver(s)`);

    return res.status(200).json(rows);
  } catch (err) {
    console.log("========== GET AVAILABLE DRIVERS ERROR ==========");
    console.error(err);
    console.log("==================================================");

    return res.status(500).json({
      success: false,
      message: "Failed to fetch available drivers.",
    });
  }
});
// =====================================================
// GET ALL VEHICLES
// =====================================================
router.get("/list", async (req, res) => {
  try {
    console.log("[vehicle] GET /list");

    const rows = await Select(
      `
      SELECT
        v.id,
        v.vehicle_code,
        v.plate_number,
        v.vehicle_type,
        v.brand,
        v.model,
        v.capacity,
        v.year_model,
        v.color,
        v.fuel_type,
        v.odometer,
        v.driver_id,
        v.registration_expiry,
        v.insurance_expiry,
        v.status,
        v.remarks,
        v.created_by,
        v.created_at,
        v.updated_at,

        d.driver_code,
        CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
        d.attendance_status,
        d.availability_status

      FROM vehicles v

      LEFT JOIN drivers d
        ON v.driver_id = d.id

      ORDER BY
        v.created_at DESC,
        v.id DESC
      `,
    );

    console.log(`[vehicle] -> ${rows.length} vehicle(s) returned`);

    return res.status(200).json(rows);
  } catch (err) {
    console.log("========== GET VEHICLES ERROR ==========");
    console.error(err);
    console.log("=========================================");

    return res.status(500).json({
      success: false,
      message: "Failed to fetch vehicles.",
    });
  }
});

// =====================================================
// GET SINGLE VEHICLE
// =====================================================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[vehicle] GET /${id}`);

    if (!id || isNaN(id)) {
      console.log(`[vehicle] Rejected: invalid id "${id}"`);
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle ID.",
      });
    }

    const rows = await Select(
      `
      SELECT
        v.id,
        v.vehicle_code,
        v.plate_number,
        v.vehicle_type,
        v.brand,
        v.model,
        v.capacity,
        v.year_model,
        v.color,
        v.fuel_type,
        v.odometer,
        v.driver_id,
        v.registration_expiry,
        v.insurance_expiry,
        v.status,
        v.remarks,
        v.created_by,
        v.created_at,
        v.updated_at,

        d.driver_code,
        CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
        d.attendance_status,
        d.availability_status

      FROM vehicles v

      LEFT JOIN drivers d
        ON v.driver_id = d.id

      WHERE v.id = ?
      LIMIT 1
      `,
      [id],
    );

    if (rows.length === 0) {
      console.log(`[vehicle] Vehicle ${id} not found`);
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.log("========== GET VEHICLE ERROR ==========");
    console.error(err);
    console.log("========================================");

    return res.status(500).json({
      success: false,
      message: "Failed to fetch vehicle.",
    });
  }
});

// =====================================================
// CREATE VEHICLE
// =====================================================
router.post("/", async (req, res) => {
  try {
    const {
      plate_number,
      vehicle_type,
      capacity,
      brand,
      model,
      year_model,
      color,
      fuel_type,
      odometer,
      driver_id,
      registration_expiry,
      insurance_expiry,
      status,
      remarks,
    } = req.body;

    console.log("========== CREATE VEHICLE REQUEST ==========");
    console.log(req.body);
    console.log("=============================================");

    // =====================================================
    // Validation
    // =====================================================
    if (!plate_number || !vehicle_type) {
      console.log("[vehicle] Rejected: missing plate_number/vehicle_type");
      return res.status(400).json({
        success: false,
        message: "Plate Number and Vehicle Type are required.",
      });
    }

    // =====================================================
    // Check Plate Number Uniqueness
    // `plate_number` has a UNIQUE index in the DB. Without this
    // check, a duplicate plate crashes the request with a raw
    // ER_DUP_ENTRY 500 instead of a clear validation message.
    // This is a pre-check for the common case; the catch block
    // below still handles ER_DUP_ENTRY as a safety net in case
    // two requests race between this check and the INSERT.
    // =====================================================
    const existingPlate = await Select(
      `SELECT id, vehicle_code FROM vehicles WHERE plate_number = ? LIMIT 1`,
      [plate_number],
    );

    if (existingPlate.length > 0) {
      console.log(
        `[vehicle] Rejected: plate_number "${plate_number}" already used by vehicle ${existingPlate[0].vehicle_code}`,
      );
      return res.status(409).json({
        success: false,
        message: `Plate number "${plate_number}" is already registered to vehicle ${existingPlate[0].vehicle_code}.`,
      });
    }

    // =====================================================
    // Validate Driver (if selected) — reads go through the
    // shared getDriverInfo() helper.
    // =====================================================
    if (driver_id) {
      console.log(`[vehicle] Validating driver ${driver_id} before assignment`);

      const driver = await getDriverInfo(driver_id);

      if (!driver || !driver.is_active) {
        console.log(
          `[vehicle] Rejected: driver ${driver_id} not found/inactive`,
        );
        return res.status(404).json({
          success: false,
          message: "Selected driver was not found.",
        });
      }

      if (driver.attendance_status !== "Present") {
        console.log(
          `[vehicle] Rejected: driver ${driver_id} attendance is "${driver.attendance_status}"`,
        );
        return res.status(400).json({
          success: false,
          message: "Selected driver is not present.",
        });
      }

      if (
        driver.availability_status &&
        driver.availability_status !== "Available"
      ) {
        console.log(
          `[vehicle] Rejected: driver ${driver_id} availability is "${driver.availability_status}"`,
        );
        return res.status(400).json({
          success: false,
          message: `Driver is currently ${driver.availability_status}.`,
        });
      }
    }

    // =====================================================
    // Generate Vehicle Code
    // Example: VH-2026-000001
    // =====================================================
    const vehicle_code = await generateNextVehicleCode();

    console.log("[vehicle] Generated vehicle code:", vehicle_code);

    // =====================================================
    // Vehicle Status
    // A newly registered vehicle is ALWAYS "Available" — having
    // a default driver picked at registration time does NOT mean
    // a shipment is active. "Assigned"/"In Transit" only happen
    // via setVehicleAvailability() from the shipment dispatch
    // flow. If the client tries to sneak in a system-managed
    // status here, fall back to "Available" instead of trusting it.
    // =====================================================
    const vehicleStatus = SYSTEM_MANAGED_VEHICLE_STATUSES.includes(status)
      ? "Available"
      : status || "Available";

    if (SYSTEM_MANAGED_VEHICLE_STATUSES.includes(status)) {
      console.log(
        `[vehicle] Ignored client-supplied system-managed status "${status}" on create — forced to "Available".`,
      );
    }

    // =====================================================
    // Save Vehicle
    // =====================================================
    await Insert(
      `
      INSERT INTO vehicles (
        vehicle_code,
        plate_number,
        vehicle_type,
        capacity,
        brand,
        model,
        year_model,
        color,
        fuel_type,
        odometer,
        driver_id,
        registration_expiry,
        insurance_expiry,
        status,
        remarks,
        created_by,
        created_at
      )
      VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW()
      )
      `,
      [
        vehicle_code,
        plate_number,
        vehicle_type,
        capacity || null,
        brand || null,
        model || null,
        year_model || null,
        color || null,
        fuel_type || null,
        odometer || 0,
        driver_id || null,
        registration_expiry || null,
        insurance_expiry || null,
        vehicleStatus,
        remarks || null,
        req.user?.name || "Admin",
      ],
    );

    // =====================================================
    // Update Driver Availability (via the shared helper —
    // this is the same function shipmentDispatch is meant to
    // call, so both features write through one place)
    // =====================================================
    if (driver_id) {
      await setDriverAvailability(driver_id, "Assigned");
    }

    console.log("========== VEHICLE CREATED ==========");
    console.log({
      vehicle_code,
      plate_number,
      driver_id: driver_id || null,
      status: vehicleStatus,
    });
    console.log("======================================");

    return res.status(201).json({
      success: true,
      message: "Vehicle registered successfully.",
      vehicle_code,
    });
  } catch (err) {
    console.log("========== CREATE VEHICLE ERROR ==========");
    console.error(err);
    console.log("===========================================");

    // Safety net: if a duplicate plate slipped past the pre-check
    // above (e.g. two requests submitted at almost the same time),
    // surface it as a clean 409 instead of a raw 500 stack trace.
    if (err.code === "ER_DUP_ENTRY") {
      console.log(
        `[vehicle] Duplicate entry caught at INSERT: ${err.sqlMessage}`,
      );
      return res.status(409).json({
        success: false,
        message: `Plate number "${req.body.plate_number}" is already registered.`,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create vehicle.",
    });
  }
});

// =====================================================
// UPDATE VEHICLE
// =====================================================
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      plate_number,
      vehicle_type,
      capacity,
      brand,
      model,
      year_model,
      color,
      fuel_type,
      odometer,
      driver_id,
      registration_expiry,
      insurance_expiry,
      status,
      remarks,
    } = req.body;

    console.log("========== UPDATE VEHICLE REQUEST ==========");
    console.log({ id, ...req.body });
    console.log("=============================================");

    // =====================================================
    // Validate
    // =====================================================
    if (!plate_number || !vehicle_type) {
      console.log("[vehicle] Rejected: missing plate_number/vehicle_type");
      return res.status(400).json({
        success: false,
        message: "Plate Number and Vehicle Type are required.",
      });
    }

    // =====================================================
    // Check Vehicle Exists
    // =====================================================
    const vehicle = await Select(
      `
      SELECT id, driver_id, status
      FROM vehicles
      WHERE id = ?
      `,
      [id],
    );

    if (!vehicle.length) {
      console.log(`[vehicle] Vehicle ${id} not found`);
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    const oldDriverId = vehicle[0].driver_id;

    // Block manually setting a shipment-managed status from this
    // screen — mirrors the same guard on driverRegistration's
    // PUT /:id. "Assigned"/"In Transit" are only ever set by
    // setVehicleAvailability() from the shipment dispatch flow.
    if (SYSTEM_MANAGED_VEHICLE_STATUSES.includes(status)) {
      console.log(
        `[vehicle] Rejected manual status change to "${status}" for vehicle ${id} — system-managed status.`,
      );
      return res.status(400).json({
        success: false,
        message: `"${status}" can't be set manually. It's applied automatically when a shipment is assigned to this vehicle, and cleared automatically when the shipment is completed or cancelled.`,
      });
    }

    // =====================================================
    // Check Plate Number Uniqueness (excluding this vehicle)
    // Same UNIQUE-index issue as create: if the plate is being
    // changed to one already used by a different vehicle, fail
    // clearly here instead of letting a raw ER_DUP_ENTRY hit the
    // UPDATE statement below.
    // =====================================================
    const existingPlate = await Select(
      `SELECT id, vehicle_code FROM vehicles WHERE plate_number = ? AND id != ? LIMIT 1`,
      [plate_number, id],
    );

    if (existingPlate.length > 0) {
      console.log(
        `[vehicle] Rejected: plate_number "${plate_number}" already used by vehicle ${existingPlate[0].vehicle_code}`,
      );
      return res.status(409).json({
        success: false,
        message: `Plate number "${plate_number}" is already registered to vehicle ${existingPlate[0].vehicle_code}.`,
      });
    }

    // =====================================================
    // Validate New Driver (only if it's actually changing)
    // =====================================================
    if (driver_id && Number(driver_id) !== Number(oldDriverId)) {
      console.log(
        `[vehicle] Driver change detected on vehicle ${id}: ${oldDriverId || "none"} -> ${driver_id}`,
      );

      const driver = await getDriverInfo(driver_id);

      if (!driver || !driver.is_active) {
        console.log(
          `[vehicle] Rejected: driver ${driver_id} not found/inactive`,
        );
        return res.status(404).json({
          success: false,
          message: "Selected driver not found.",
        });
      }

      if (driver.attendance_status !== "Present") {
        console.log(
          `[vehicle] Rejected: driver ${driver_id} attendance is "${driver.attendance_status}"`,
        );
        return res.status(400).json({
          success: false,
          message: "Selected driver is not present.",
        });
      }

      if (
        driver.availability_status &&
        driver.availability_status !== "Available"
      ) {
        console.log(
          `[vehicle] Rejected: driver ${driver_id} availability is "${driver.availability_status}"`,
        );
        return res.status(400).json({
          success: false,
          message: `Driver is currently ${driver.availability_status}.`,
        });
      }
    }

    // =====================================================
    // Update Vehicle
    // =====================================================
    await Update(
      `
      UPDATE vehicles
      SET
        plate_number = ?,
        vehicle_type = ?,
        capacity = ?,
        brand = ?,
        model = ?,
        year_model = ?,
        color = ?,
        fuel_type = ?,
        odometer = ?,
        driver_id = ?,
        registration_expiry = ?,
        insurance_expiry = ?,
        status = ?,
        remarks = ?,
        updated_at = NOW()
      WHERE id = ?
      `,
      [
        plate_number,
        vehicle_type,
        capacity || null,
        brand || null,
        model || null,
        year_model || null,
        color || null,
        fuel_type || null,
        odometer || 0,
        driver_id || null,
        registration_expiry || null,
        insurance_expiry || null,
        status,
        remarks || null,
        id,
      ],
    );

    // =====================================================
    // Driver Changed — release old, assign new. Both writes
    // go through the shared setDriverAvailability() helper.
    // =====================================================
    if (Number(oldDriverId) !== Number(driver_id)) {
      if (oldDriverId) {
        console.log(
          `[vehicle] Releasing old driver ${oldDriverId} -> Available`,
        );
        await setDriverAvailability(oldDriverId, "Available");
      }

      if (driver_id) {
        console.log(`[vehicle] Assigning new driver ${driver_id} -> Assigned`);
        await setDriverAvailability(driver_id, "Assigned");
      }
    }

    console.log("========== VEHICLE UPDATED ==========");
    console.log({ id, plate_number, driver_id: driver_id || null, status });
    console.log("======================================");

    return res.json({
      success: true,
      message: "Vehicle updated successfully.",
    });
  } catch (err) {
    console.log("========== UPDATE VEHICLE ERROR ==========");
    console.error(err);
    console.log("===========================================");

    if (err.code === "ER_DUP_ENTRY") {
      console.log(
        `[vehicle] Duplicate entry caught at UPDATE: ${err.sqlMessage}`,
      );
      return res.status(409).json({
        success: false,
        message: `Plate number "${req.body.plate_number}" is already registered.`,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update vehicle.",
    });
  }
});

// =====================================================
// DELETE VEHICLE
// (kept for API completeness — the Delete button was removed
// from the Vehicle Management table in the UI)
// =====================================================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[vehicle] DELETE /${id}`);

    const vehicle = await Select(
      `
      SELECT
        id,
        driver_id,
        vehicle_code
      FROM vehicles
      WHERE id = ?
      `,
      [id],
    );

    if (!vehicle.length) {
      console.log(`[vehicle] Vehicle ${id} not found`);
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    const driverId = vehicle[0].driver_id;

    // Release the assigned driver via the shared helper.
    if (driverId) {
      console.log(`[vehicle] Releasing driver ${driverId} -> Available`);
      await setDriverAvailability(driverId, "Available");
    }

    await Delete(
      `
      DELETE FROM vehicles
      WHERE id = ?
      `,
      [id],
    );

    console.log(`[vehicle] Vehicle ${id} (${vehicle[0].vehicle_code}) deleted`);

    return res.status(200).json({
      success: true,
      message: "Vehicle deleted successfully.",
      vehicle_code: vehicle[0].vehicle_code,
    });
  } catch (err) {
    console.log("========== DELETE VEHICLE ERROR ==========");
    console.error(err);
    console.log("===========================================");

    return res.status(500).json({
      success: false,
      message: "Failed to delete vehicle.",
    });
  }
});

// =====================================================
// EXPORT EXCEL — server-side, styled, exports ALL vehicles
// (not just the current page, since the table only renders a
// fixed page size now)
// =====================================================
router.get("/export/excel", async (req, res) => {
  try {
    console.log("[vehicle] GET /export/excel");

    const vehicles = await Select(`
      SELECT
        v.id, v.vehicle_code, v.plate_number, v.vehicle_type, v.brand,
        v.model, v.capacity, v.registration_expiry, v.insurance_expiry,
        v.status, v.remarks, v.created_at, v.created_by,
        CONCAT(d.first_name, ' ', d.last_name) AS driver_name
      FROM vehicles v
      LEFT JOIN drivers d ON v.driver_id = d.id
      ORDER BY v.created_at DESC, v.id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Vehicles", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    sheet.mergeCells("A1:K1");
    sheet.getCell("A1").value = "Vehicle List Report";
    sheet.getCell("A1").font = {
      size: 16,
      bold: true,
      color: { argb: "FF1F2937" },
    };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.mergeCells("A2:K2");
    sheet.getCell("A2").value = `Generated on ${new Date().toLocaleString()}`;
    sheet.getCell("A2").font = {
      size: 10,
      italic: true,
      color: { argb: "FF6B7280" },
    };
    sheet.getCell("A2").alignment = { horizontal: "center" };

    sheet.mergeCells("A3:K3");
    sheet.getCell("A3").value = `Total Vehicles: ${vehicles.length}`;
    sheet.getCell("A3").font = { size: 10, bold: true };
    sheet.getCell("A3").alignment = { horizontal: "center" };

    const headerRow = sheet.getRow(4);
    headerRow.values = [
      "ID",
      "Code",
      "Plate Number",
      "Type",
      "Brand",
      "Model",
      "Capacity",
      "Assigned Driver",
      "Registration Expiry",
      "Insurance Expiry",
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

    vehicles.forEach((v, i) => {
      const row = sheet.addRow([
        v.id,
        v.vehicle_code,
        v.plate_number,
        v.vehicle_type,
        v.brand || "-",
        v.model || "-",
        v.capacity || "-",
        v.driver_name || "Unassigned",
        v.registration_expiry || "-",
        v.insurance_expiry || "-",
        v.status,
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
      { width: 6 },
      { width: 16 },
      { width: 16 },
      { width: 12 },
      { width: 16 },
      { width: 16 },
      { width: 10 },
      { width: 22 },
      { width: 16 },
      { width: 16 },
      { width: 14 },
    ];
    sheet.autoFilter = { from: "A4", to: "K4" };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=vehicles.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.log("========== EXPORT EXCEL ERROR ==========");
    console.error(err);
    console.log("=========================================");
    res
      .status(500)
      .json({ success: false, message: "Failed to export vehicles." });
  }
});

// =====================================================
// DOWNLOAD BULK UPLOAD TEMPLATE — styled .xlsx
// =====================================================
router.get("/bulk/template", async (req, res) => {
  try {
    console.log("[vehicle] GET /bulk/template");

    const availableDrivers = await Select(`
      SELECT driver_code, CONCAT(first_name, ' ', last_name) AS driver_name
      FROM drivers
      WHERE is_active = 1 AND attendance_status = 'Present'
        AND (availability_status = 'Available' OR availability_status IS NULL OR availability_status = '')
      ORDER BY first_name ASC
    `);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LMS";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Vehicles", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = [
      { header: "plate_number", key: "plate_number", width: 16 },
      { header: "vehicle_type", key: "vehicle_type", width: 14 },
      { header: "brand", key: "brand", width: 16 },
      { header: "model", key: "model", width: 16 },
      { header: "capacity", key: "capacity", width: 12 },
      { header: "year_model", key: "year_model", width: 12 },
      { header: "color", key: "color", width: 12 },
      { header: "fuel_type", key: "fuel_type", width: 12 },
      { header: "odometer", key: "odometer", width: 12 },
      { header: "driver_code", key: "driver_code", width: 16 },
      { header: "registration_expiry", key: "registration_expiry", width: 18 },
      { header: "insurance_expiry", key: "insurance_expiry", width: 18 },
      { header: "remarks", key: "remarks", width: 30 },
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
      plate_number: "ABC-1234",
      vehicle_type: "Van",
      brand: "Toyota",
      model: "HiAce",
      capacity: 5000,
      year_model: 2026,
      color: "White",
      fuel_type: "Diesel",
      odometer: 0,
      driver_code: availableDrivers[0]?.driver_code || "",
      registration_expiry: "",
      insurance_expiry: "",
      remarks: "",
    });
    sampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: "FF999999" } };
    });

    for (let r = 2; r <= 50; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= 13; c++) {
        row.getCell(c).border = {
          top: { style: "hair", color: { argb: "FFEEEEEE" } },
          bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
          left: { style: "hair", color: { argb: "FFEEEEEE" } },
          right: { style: "hair", color: { argb: "FFEEEEEE" } },
        };
      }
    }

    const refSheet = workbook.addWorksheet("Valid Types & Drivers");
    refSheet.columns = [{ width: 20 }, { width: 20 }, { width: 30 }];
    refSheet.getRow(1).values = [
      "Vehicle Type",
      "Available Driver Code",
      "Driver Name",
    ];
    refSheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF198754" },
      };
    });
    const maxRows = Math.max(
      VALID_VEHICLE_TYPES.length,
      availableDrivers.length,
    );
    for (let i = 0; i < maxRows; i++) {
      refSheet.addRow([
        VALID_VEHICLE_TYPES[i] || "",
        availableDrivers[i]?.driver_code || "",
        availableDrivers[i]?.driver_name || "",
      ]);
    }

    const infoSheet = workbook.addWorksheet("Instructions");
    infoSheet.columns = [{ width: 95 }];
    infoSheet.addRow(["Bulk Upload Instructions"]).font = {
      bold: true,
      size: 14,
    };
    infoSheet.addRow([]);
    infoSheet.addRow([
      "1. Fill in one row per vehicle on the 'Vehicles' sheet.",
    ]);
    infoSheet.addRow(["2. Do not rename or reorder the header row."]);
    infoSheet.addRow([
      "3. plate_number and vehicle_type are required; vehicle_type must be one of the values on 'Valid Types & Drivers'.",
    ]);
    infoSheet.addRow(["4. plate_number must be unique across the system."]);
    infoSheet.addRow([
      "5. driver_code is optional — leave blank to register the vehicle unassigned. If provided, it must match an available driver on 'Valid Types & Drivers'.",
    ]);
    infoSheet.addRow([
      "6. Dates (registration_expiry, insurance_expiry) should be in YYYY-MM-DD format, if provided.",
    ]);
    infoSheet.addRow([
      '7. Every uploaded vehicle is created with status "Available" — "Assigned"/"In Transit" are set automatically once a shipment is dispatched.',
    ]);
    infoSheet.addRow([
      "8. Delete the sample row before uploading, or leave it — invalid rows are skipped and listed in the upload report.",
    ]);
    infoSheet.addRow([
      "9. Save the file and upload it via Vehicle Management > Bulk Upload.",
    ]);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=vehicle_upload_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.log("========== DOWNLOAD TEMPLATE ERROR ==========");
    console.error(err);
    console.log("==============================================");
    res
      .status(500)
      .json({ success: false, message: "Failed to generate template." });
  }
});

// =====================================================
// BULK UPLOAD VEHICLES — parses .xlsx/.xls/.csv, validates
// every row, inserts only the valid ones, returns a per-row
// report. Reuses the same plate-uniqueness, driver-validation,
// vehicle-code-generation, and "always Available on create"
// rules as the single-vehicle CREATE route above.
// =====================================================
router.post("/bulk/upload", upload.single("file"), async (req, res) => {
  try {
    console.log("[vehicle] POST /bulk/upload");

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file was uploaded." });
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
        .json({
          success: false,
          message: "Could not read the file. Please check the format.",
        });
    }

    if (!rows || rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "The file has no rows to import." });
    }
    if (rows.length > 1000) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Please limit bulk uploads to 1000 rows at a time.",
        });
    }

    const normalizeKey = (obj, ...candidates) => {
      for (const c of candidates) {
        const key = Object.keys(obj).find((k) => k.trim().toLowerCase() === c);
        if (key) return obj[key];
      }
      return "";
    };

    const [existingPlates, availableDrivers] = await Promise.all([
      Select("SELECT plate_number FROM vehicles"),
      Select(`
        SELECT id, driver_code, availability_status, attendance_status, is_active
        FROM drivers
        WHERE is_active = 1 AND attendance_status = 'Present'
          AND (availability_status = 'Available' OR availability_status IS NULL OR availability_status = '')
      `),
    ]);

    const existingPlateSet = new Set(
      existingPlates.map((p) => p.plate_number.trim().toLowerCase()),
    );
    const driverMap = new Map(
      availableDrivers.map((d) => [d.driver_code.trim().toLowerCase(), d.id]),
    );
    const seenPlates = new Set();
    const seenDriverCodes = new Set();

    const toInsert = [];
    const report = { total: rows.length, success: 0, failed: 0, errors: [] };

    for (let idx = 0; idx < rows.length; idx++) {
      const raw = rows[idx];
      const rowNum = idx + 2;
      const rowErrors = [];

      const plate_number = String(
        normalizeKey(raw, "plate_number", "plate number"),
      ).trim();
      const vehicle_type = String(
        normalizeKey(raw, "vehicle_type", "vehicle type", "type"),
      ).trim();
      const brand = String(normalizeKey(raw, "brand")).trim();
      const model = String(normalizeKey(raw, "model")).trim();
      const capacity = String(normalizeKey(raw, "capacity")).trim();
      const year_model = String(
        normalizeKey(raw, "year_model", "year model"),
      ).trim();
      const color = String(normalizeKey(raw, "color")).trim();
      const fuel_type = String(
        normalizeKey(raw, "fuel_type", "fuel type"),
      ).trim();
      const odometer = String(normalizeKey(raw, "odometer")).trim();
      const driver_code = String(
        normalizeKey(raw, "driver_code", "driver code"),
      ).trim();
      const registration_expiry = String(
        normalizeKey(raw, "registration_expiry"),
      ).trim();
      const insurance_expiry = String(
        normalizeKey(raw, "insurance_expiry"),
      ).trim();
      const remarks = String(normalizeKey(raw, "remarks")).trim();

      if (!plate_number) rowErrors.push("Plate number is required.");
      if (!vehicle_type) {
        rowErrors.push("Vehicle type is required.");
      } else if (!VALID_VEHICLE_TYPES.includes(vehicle_type)) {
        rowErrors.push(
          `Vehicle type "${vehicle_type}" is invalid — must be one of ${VALID_VEHICLE_TYPES.join(", ")}.`,
        );
      }

      const plateKey = plate_number.toLowerCase();
      if (plate_number && existingPlateSet.has(plateKey)) {
        rowErrors.push(`Plate number "${plate_number}" already exists.`);
      } else if (plate_number && seenPlates.has(plateKey)) {
        rowErrors.push(
          `Plate number "${plate_number}" is duplicated within the file.`,
        );
      }

      let driverId = null;
      if (driver_code) {
        const driverKey = driver_code.toLowerCase();
        if (!driverMap.has(driverKey)) {
          rowErrors.push(
            `Driver code "${driver_code}" was not found or is not available.`,
          );
        } else if (seenDriverCodes.has(driverKey)) {
          rowErrors.push(
            `Driver code "${driver_code}" is assigned to more than one row in this file.`,
          );
        } else {
          driverId = driverMap.get(driverKey);
        }
      }

      if (rowErrors.length > 0) {
        report.failed++;
        report.errors.push({ row: rowNum, message: rowErrors.join(" ") });
        continue;
      }

      seenPlates.add(plateKey);
      if (driver_code) seenDriverCodes.add(driver_code.toLowerCase());

      toInsert.push({
        plate_number,
        vehicle_type,
        brand: brand || null,
        model: model || null,
        capacity: capacity ? Number(capacity) : null,
        year_model: year_model ? Number(year_model) : null,
        color: color || null,
        fuel_type: fuel_type || null,
        odometer: odometer ? Number(odometer) : 0,
        driver_id: driverId,
        registration_expiry: registration_expiry || null,
        insurance_expiry: insurance_expiry || null,
        remarks: remarks || null,
      });
    }

    for (const v of toInsert) {
      const vehicle_code = await generateNextVehicleCode();

      await Insert(
        `
        INSERT INTO vehicles (
          vehicle_code, plate_number, vehicle_type, capacity, brand, model,
          year_model, color, fuel_type, odometer, driver_id,
          registration_expiry, insurance_expiry, status, remarks,
          created_by, created_at
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
        `,
        [
          vehicle_code,
          v.plate_number,
          v.vehicle_type,
          v.capacity,
          v.brand,
          v.model,
          v.year_model,
          v.color,
          v.fuel_type,
          v.odometer,
          v.driver_id,
          v.registration_expiry,
          v.insurance_expiry,
          "Available",
          v.remarks,
          req.user?.name || "Admin",
        ],
      );

      if (v.driver_id) {
        await setDriverAvailability(v.driver_id, "Assigned");
      }

      report.success++;
    }

    console.log(
      `[vehicle] Bulk upload complete: ${report.success}/${report.total} inserted, ${report.failed} failed`,
    );

    res.json({
      success: true,
      message: `${report.success} of ${report.total} vehicles imported successfully.`,
      report,
    });
  } catch (err) {
    console.log("========== BULK UPLOAD ERROR ==========");
    console.error(err);
    console.log("========================================");
    res.status(500).json({ success: false, message: "Bulk upload failed." });
  }
});

module.exports = router;

// =====================================================
// SHARED HELPERS — exported for other routers
// (e.g. shipmentDispatch) to reuse, same pattern as
// driverRegistration's setDriverAvailability/getDriverInfo.
// =====================================================

/**
 * The single place in the codebase allowed to change a vehicle's
 * status. Call this:
 *
 *   - From shipmentDispatch's POST /assign, right after the
 *     shipment_dispatch row is inserted:
 *       await setVehicleAvailability(vehicle_id, "Assigned");
 *     (or "In Transit" once the shipment is actually en route,
 *     if your flow distinguishes the two)
 *
 *   - From wherever a shipment is marked Delivered / Cancelled:
 *       await setVehicleAvailability(vehicle_id, "Available");
 */
async function setVehicleAvailability(vehicleId, status) {
  console.log(
    `[vehicle] setVehicleAvailability(vehicleId=${vehicleId}, status="${status}")`,
  );

  await Update(
    `UPDATE vehicles SET status = ?, updated_at = NOW() WHERE id = ?`,
    [status, vehicleId],
  );
}

/**
 * Lightweight read used to validate a vehicle is still
 * "Available" right before assigning a shipment to it (guards
 * against a race where two shipments try to grab the same
 * vehicle at once).
 */
async function getVehicleInfo(vehicleId) {
  console.log(`[vehicle] getVehicleInfo(vehicleId=${vehicleId})`);

  const rows = await Select(
    `SELECT id, vehicle_code, status, driver_id FROM vehicles WHERE id = ?`,
    [vehicleId],
  );

  return rows.length ? rows[0] : null;
}

/**
 * Generates the next sequential vehicle_code for the current year
 * (e.g. VH-2026-000007). Shared by the single-vehicle CREATE route
 * and the bulk-upload loop so both follow the exact same numbering.
 */
async function generateNextVehicleCode() {
  const currentYear = new Date().getFullYear();

  const lastVehicle = await Select(
    `
    SELECT vehicle_code
    FROM vehicles
    WHERE vehicle_code LIKE ?
    ORDER BY id DESC
    LIMIT 1
    `,
    [`VH-${currentYear}-%`],
  );

  let nextNumber = 1;

  if (lastVehicle.length > 0) {
    const parts = lastVehicle[0].vehicle_code.split("-");
    if (parts.length === 3) {
      nextNumber = parseInt(parts[2]) + 1;
    }
  }

  return `VH-${currentYear}-${String(nextNumber).padStart(6, "0")}`;
}

module.exports.setVehicleAvailability = setVehicleAvailability;
module.exports.getVehicleInfo = getVehicleInfo;

/* ============================================================
   INTEGRATION NOTE FOR shipmentDispatch ROUTER
   ------------------------------------------------------------
   const {
     setDriverAvailability,
     getDriverInfo,
   } = require("./driverRegistration");

   const {
     setVehicleAvailability,
     getVehicleInfo,
   } = require("./vehicle");

   router.post("/assign", async (req, res) => {
     const { driver_id, vehicle_id } = req.body;

     const driver = await getDriverInfo(driver_id);
     if (!driver || driver.availability_status !== "Available") {
       return res.status(400).json({
         message: `Driver is currently "${driver?.availability_status}" and cannot be assigned.`,
       });
     }

     const vehicle = await getVehicleInfo(vehicle_id);
     if (!vehicle || vehicle.status !== "Available") {
       return res.status(400).json({
         message: `Vehicle is currently "${vehicle?.status}" and cannot be assigned.`,
       });
     }

     // ...insert the shipment_dispatch row here...

     await setDriverAvailability(driver_id, "Assigned");
     await setVehicleAvailability(vehicle_id, "Assigned");

     res.json({ message: "Driver and vehicle assigned successfully." });
   });

   // When the shipment is later marked Delivered/Cancelled:
   await setDriverAvailability(driver_id, "Available");
   await setVehicleAvailability(vehicle_id, "Available");
   ============================================================ */
