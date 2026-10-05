var express = require("express");
var router = express.Router();
const axios = require("axios");
const crypto = require("crypto");
const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");

// Move these to your .env file (dotenv/config already loaded in app.js presumably)
const EXTERNAL_API_URL =
  process.env.EXTERNAL_DRIVER_API_URL ||
  "http://localhost:3000/driverRequest/api/driver-requests";
const EXTERNAL_API_KEY =
  process.env.EXTERNAL_DRIVER_API_KEY ||
  "af88129f1afc5311f9a3ee77e7d824374a1d5287933e977415a269dea6d3f849";

// Status values. APPROVED is reached through the checklist-gated Approve
// modal on the frontend; the others are set manually via Edit Status.
const DRIVER_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "IN_PROGRESS",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
];

// Matches driver_request exactly — no driver/vehicle assignment columns.
const DRIVER_REQUEST_COLUMNS = `
  dr_id, dr_requestId, dr_storeId, dr_ticketNumber,
  dr_storeName, dr_storeCode, dr_requestType,
  dr_itemName, dr_asset, dr_serial, dr_requestQty,
  dr_notes, dr_status, dr_createdDate, dr_createdBy
`;

/**
 * @swagger
 * /driverRequest/api/generate-key:
 *   post:
 *     summary: Generate a new random API key
 *     tags: [Driver Requests]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: A freshly generated key
 */
router.post("/api/generate-key", function (req, res) {
  const apiKey = crypto.randomBytes(32).toString("hex");
  res.json({ success: true, apiKey });
});

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("driverRequest", { title: "Driver Requests" });
});

/**
 * @swagger
 * /driverRequest/api/driver-requests:
 *   get:
 *     summary: List all driver requests
 *     tags: [Driver Requests]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of driver requests
 *       401:
 *         $ref: "#/components/responses/Unauthorized"
 *       500:
 *         description: Server error
 */
router.get("/api/driver-requests", async function (req, res) {
  try {
    const query = `
      SELECT ${DRIVER_REQUEST_COLUMNS}
      FROM driver_request
      ORDER BY dr_createdDate DESC
    `;
    const rows = await Select(query);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Failed to fetch driver requests:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch driver requests" });
  }
});

/**
 * @swagger
 * /driverRequest/api/driver-requests/{id}:
 *   get:
 *     summary: Get a single driver request (for the View modal)
 *     tags: [Driver Requests]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: The driver request
 *       404:
 *         description: Not found
 *       401:
 *         $ref: "#/components/responses/Unauthorized"
 */
router.get("/api/driver-requests/:id", async function (req, res) {
  try {
    const rows = await Select(
      `SELECT ${DRIVER_REQUEST_COLUMNS} FROM driver_request WHERE dr_id = ?`,
      [req.params.id],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Driver request not found." });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("Failed to fetch driver request:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch driver request." });
  }
});

/**
 * @swagger
 * /driverRequest/api/driver-requests/{id}/status:
 *   put:
 *     summary: Update a driver request's status
 *     description: >
 *       Used both for manual status overrides (Edit Status) and for the
 *       checklist-gated Approve flow (which PUTs status=APPROVED once
 *       every checklist item is checked client-side — no separate
 *       approve endpoint or server-stored checklist state).
 *     tags: [Driver Requests]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, APPROVED, IN_PROGRESS, COMPLETED, REJECTED, CANCELLED]
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Not found
 *       401:
 *         $ref: "#/components/responses/Unauthorized"
 */
router.put("/api/driver-requests/:id/status", async function (req, res) {
  try {
    const { status } = req.body;

    if (!status || !DRIVER_REQUEST_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${DRIVER_REQUEST_STATUSES.join(", ")}`,
      });
    }

    const existing = await Select(
      `SELECT dr_id FROM driver_request WHERE dr_id = ?`,
      [req.params.id],
    );

    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Driver request not found." });
    }

    await Update(`UPDATE driver_request SET dr_status = ? WHERE dr_id = ?`, [
      status,
      req.params.id,
    ]);

    res.json({ success: true, message: "Status updated successfully." });
  } catch (err) {
    console.error("Failed to update status:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update status." });
  }
});

/**
 * @swagger
 * /driverRequest/api/driver-requests/sync:
 *   post:
 *     summary: Sync all PENDING driver requests to the external system
 *     tags: [Driver Requests]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Sync attempted for each pending record
 *       401:
 *         $ref: "#/components/responses/Unauthorized"
 *       500:
 *         description: Sync failed
 */
router.post("/api/driver-requests/sync", async function (req, res) {
  try {
    const pending = await Select(
      `SELECT * FROM driver_request WHERE dr_status = ?`,
      ["PENDING"],
    );

    const results = [];

    for (const record of pending) {
      const payload = {
        requestId: record.dr_requestId,
        storeId: record.dr_storeId,
        ticketNumber: record.dr_ticketNumber,
        storeName: record.dr_storeName,
        storeCode: record.dr_storeCode,
        requestType: record.dr_requestType,
        itemName: record.dr_itemName,
        asset: record.dr_asset,
        serial: record.dr_serial,
        requestQty: record.dr_requestQty,
        notes: record.dr_notes,
        createdDate: record.dr_createdDate,
        createdBy: record.dr_createdBy,
      };

      try {
        const response = await axios.post(EXTERNAL_API_URL, payload, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${EXTERNAL_API_KEY}`,
          },
          timeout: 10000,
        });

        await Update(
          `UPDATE driver_request SET dr_status = ? WHERE dr_id = ?`,
          ["SYNCED", record.dr_id],
        );

        results.push({
          dr_id: record.dr_id,
          status: "SYNCED",
          response: response.data,
        });
      } catch (postErr) {
        console.error(
          `Failed to sync request ${record.dr_id}:`,
          postErr.message,
        );

        await Update(
          `UPDATE driver_request SET dr_status = ? WHERE dr_id = ?`,
          ["FAILED", record.dr_id],
        );

        results.push({
          dr_id: record.dr_id,
          status: "FAILED",
          error: postErr.message,
        });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("Sync failed:", err);
    res.status(500).json({ success: false, message: "Sync failed" });
  }
});

module.exports = router;
