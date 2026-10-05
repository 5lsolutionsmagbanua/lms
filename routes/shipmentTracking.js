var express = require("express");
var router = express.Router();
var multer = require("multer");
var path = require("path");
var fs = require("fs");
const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");
const { getChangedBy } = require("../middleware/auth");
const { logTrackingHistory } = require("../repository/trackingHistory");

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("shipmentTracking", { title: "Shipment Tracking" });
});

// ── proof-of-delivery photo storage ──────────────────
const PROOF_DIR = path.join(__dirname, "..", "public", "uploads", "proof");
fs.mkdirSync(PROOF_DIR, { recursive: true });

const proofStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PROOF_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const ticket = (
      req.params.trackingRowId ||
      req.body.ticket_number ||
      "proof"
    )
      .toString()
      .replace(/[^a-z0-9_-]/gi, "");
    cb(null, `${ticket}-${Date.now()}${ext}`);
  },
});

const uploadProof = multer({
  storage: proofStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, or WEBP images are allowed."));
    }
    cb(null, true);
  },
});

/* =====================================================
   STATUS VOCABULARY
   This MUST stay in sync with driverDashboard.js's
   VALID_DISPATCH_STATUSES / DISPATCH_TO_REQUEST_STATUS —
   shipment_dispatch_items.status is written by BOTH the admin
   Tracking page (mark-delivered / bulk-import / bulk-update-status
   below) and the driver mobile app (driverDashboard.js's /complete
   route), so both surfaces need to agree on what the valid status
   strings actually are. The set is:
     Preparing | Picked | In Transit | Arrived | Delayed | Delivered | Cancelled
   ("Delayed" is admin/tracking-only for now — the driver app does
   not currently expose it as an option.)
===================================================== */
const VALID_TRACKING_STATUSES = [
  "Preparing",
  "Picked",
  "In Transit",
  "Arrived",
  "Delayed",
  "Delivered",
  "Cancelled",
];

/* =====================================================
   STATUS -> APPROX PROGRESS %
   There is no stored "progress" column anywhere in the schema
   (shipment_dispatch_items only carries a status string), so this
   is a best-effort mapping used purely for the UI's progress bar.
   If/when real milestone timestamps exist (checkpoints, GPS pings,
   etc.) this should be replaced with a real calculation instead of
   a status lookup table.
===================================================== */
const STATUS_PROGRESS = {
  Preparing: 10,
  Picked: 30,
  "In Transit": 60,
  Arrived: 85,
  Delayed: 45,
  Delivered: 100,
  Cancelled: 0,
};

/* =====================================================
   MILESTONE STRIP CONFIG
   The linear "form" strip on the View modal / Timeline modal shows
   exactly these steps, in this order. "Delayed" and "Cancelled"
   don't fit a linear progression (a shipment can be delayed at any
   point, and cancellation is terminal-but-not-a-step), so they are
   surfaced separately as the `exception` object instead of being
   squeezed into the strip.

   STATUS_TO_MILESTONE normalizes a raw shipment_dispatch_items.status
   value (as logged into shipment_tracking_history.to_status) onto
   one of these canonical milestone labels. This mapping is the fix
   for the earlier mismatch where the milestone builder compared
   h.to_status directly against MILESTONE_ORDER — since the two
   vocabularies never actually agreed, ANY status reached via the
   driver app failed to register on the milestone strip except by
   accident. Every status transition, from either surface, now maps
   onto exactly one milestone step (or none, for Delayed).
===================================================== */
const MILESTONE_ORDER = [
  "Dispatched",
  "Picked",
  "In Transit",
  "Arrived",
  "Delivered",
];

const STATUS_TO_MILESTONE = {
  Preparing: "Dispatched",
  Picked: "Picked",
  "In Transit": "In Transit",
  Arrived: "Arrived",
  Delivered: "Delivered",
  // Delayed / Cancelled intentionally omitted — handled as `exception`
};

const MILESTONE_ICON = {
  Dispatched: "bi-box-seam",
  Picked: "bi-hand-index-thumb",
  "In Transit": "bi-truck",
  Arrived: "bi-signpost-split",
  Delivered: "bi-check-circle-fill",
};

/* =====================================================
   LOAD TRACKED SHIPMENTS (list/table view)

   A "tracked shipment" = one row in shipment_dispatch_items,
   since that table already keys status/remarks/delivered_at per
   ticket_number within a dispatch batch — it IS the tracking
   record, so there's no separate aggregation needed the way
   /shipmentRequest/get-shipments has to GROUP BY ticket across
   multiple item rows.

   Supports optional query filters (used by the Date Range modal):
     ?status=In+Transit
     ?dateType=dispatch|delivery         (defaults to dispatch)
     ?from=2026-06-01&to=2026-06-30

   Search box + status pills stay client-side against the full
   result set, same pattern shipmentRequest.js already uses for
   its own search/priority/status filters.
===================================================== */
router.get("/get-shipments", async (req, res) => {
  try {
    const { status, dateType, from, to } = req.query;

    // dateType decides which column the from/to range applies to.
    // "delivery" filters against when it actually arrived; anything
    // else (default) filters against when it was dispatched.
    const dateColumn =
      dateType === "delivery" ? "sdi.delivered_at" : "sd.dispatch_date";

    let sql = `
      SELECT

        sdi.id                AS tracking_row_id,
        sdi.ticket_number      AS tracking_no,
        sd.dispatch_number,

        s.store_name           AS customer,
        s.store_code,
        s.store_address,

        sr.priority,

        sdi.status,
        sdi.remarks,
        sdi.delivered_at,
        sdi.proof_photo_path,

        sd.driver_id,
        CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
        d.driver_code,

        sd.vehicle_id,
        v.vehicle_code,
        v.plate_number,

        sd.helper_name,
        sd.dispatch_date,
        sd.estimated_delivery

      FROM shipment_dispatch_items sdi

      INNER JOIN shipment_dispatch sd
        ON sdi.dispatch_id = sd.id

      LEFT JOIN drivers d
        ON sd.driver_id = d.id

      LEFT JOIN vehicles v
        ON sd.vehicle_id = v.id

      -- One representative store_id/priority per ticket, same
      -- collapsing approach shipmentRequest/get-shipments uses,
      -- since shipment_requests still has one row per item.
      INNER JOIN (
        SELECT
          ticket_number,
          MIN(store_id) AS store_id,
          MAX(priority) AS priority
        FROM shipment_requests
        GROUP BY ticket_number
      ) sr ON sr.ticket_number = sdi.ticket_number

      INNER JOIN stores s
        ON sr.store_id = s.id

      WHERE 1 = 1
    `;

    const params = [];

    if (status) {
      sql += ` AND sdi.status = ? `;
      params.push(status);
    }

    if (from) {
      sql += ` AND ${dateColumn} >= ? `;
      params.push(`${from} 00:00:00`);
    }

    if (to) {
      sql += ` AND ${dateColumn} <= ? `;
      params.push(`${to} 23:59:59`);
    }

    sql += ` ORDER BY sd.dispatch_date DESC `;

    const rows = await Select(sql, params);

    // Attach the computed progress % here rather than in the query —
    // keeps the "what does each status mean" logic in one place.
    const shipments = rows.map((row) => ({
      ...row,
      progress_pct:
        STATUS_PROGRESS[row.status] !== undefined
          ? STATUS_PROGRESS[row.status]
          : 0,
    }));

    res.json(shipments);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Failed to load tracked shipments.",
    });
  }
});

/* =====================================================
   GET SINGLE TRACKED SHIPMENT (header + items + dispatch + timeline)

   Mirrors /shipmentRequest/get-shipment/:ticket's shape (header /
   items / dispatch) so the view modal can be populated the same
   way, but this route is read-only — tracking never edits a
   shipment directly, it only displays it (updates happen via
   bulk-update-status / mark-delivered / bulk-import, OR now via the
   driver app's /driverDashboard/complete route).

   "timeline" is built from the REAL shipment_tracking_history
   table — one row per status transition, logged by whichever
   surface (admin or driver) made the change — instead of a guessed
   2-3 step mock. The very first "Dispatched" step is still seeded
   from dispatch_date since that event predates history logging for
   shipments dispatched before this table existed.

   "milestones" is the fixed Dispatched/Picked/In Transit/Arrived/
   Delivered strip, each labeled with the EARLIEST time that step
   was reached — built via STATUS_TO_MILESTONE so it correctly
   recognizes history rows regardless of which surface wrote them.
===================================================== */
router.get("/get-shipment/:ticket", async (req, res) => {
  try {
    const { ticket } = req.params;

    // ==========================
    // HEADER (same shape as shipmentRequest's header query)
    // ==========================
    const headerSql = `
      SELECT

        MIN(sr.shipment_id) AS shipment_id,
        sr.ticket_number,
        MAX(sr.barcode) AS barcode,

        sr.store_id,
        s.store_name,
        s.store_code,
        s.store_address,

        sr.priority,
        sr.status,
        sr.notes,

        MAX(sr.created_at) AS created_at

      FROM shipment_requests sr

      INNER JOIN stores s
        ON sr.store_id = s.id

      WHERE sr.ticket_number = ?

      GROUP BY
        sr.ticket_number,
        sr.store_id,
        sr.priority,
        sr.status,
        sr.notes
    `;

    const header = await Select(headerSql, [ticket]);

    if (header.length === 0) {
      return res.status(404).json({
        message: "Shipment not found.",
      });
    }

    // ==========================
    // ITEMS
    // ==========================
    const itemsSql = `
      SELECT

        sr.shipment_id,

        sr.type_id,
        t.type_name,

        sr.product_id,
        p.inventory_name AS product_name,

        sr.unit_id,
        u.unit_name,

        sr.quantity

      FROM shipment_requests sr

      INNER JOIN types t
        ON sr.type_id = t.id

      INNER JOIN products p
        ON sr.product_id = p.id

      LEFT JOIN units u
        ON sr.unit_id = u.id

      WHERE sr.ticket_number = ?

      ORDER BY sr.shipment_id ASC
    `;

    const items = await Select(itemsSql, [ticket]);

    // ==========================
    // DISPATCH / TRACKING INFO
    // Note: sdi.id is selected as tracking_row_id so the front-end
    // "Mark as Delivered" button knows which row to update.
    // ==========================
    const dispatchSql = `
      SELECT

        sd.id AS dispatch_id,
        sd.dispatch_number,

        sdi.id AS tracking_row_id,

        sd.driver_id,
        CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
        d.driver_code,

        sd.vehicle_id,
        v.vehicle_code,
        v.plate_number,

        sd.helper_name,
        sd.dispatch_date,
        sd.estimated_delivery,

        sdi.remarks,
        sdi.status AS dispatch_status,
        sdi.delivered_at,
        sdi.proof_photo_path

      FROM shipment_dispatch_items sdi

      INNER JOIN shipment_dispatch sd
        ON sdi.dispatch_id = sd.id

      LEFT JOIN drivers d
        ON sd.driver_id = d.id

      LEFT JOIN vehicles v
        ON sd.vehicle_id = v.id

      WHERE sdi.ticket_number = ?

      LIMIT 1
    `;

    const dispatchRows = await Select(dispatchSql, [ticket]);
    const dispatch = dispatchRows.length ? dispatchRows[0] : null;

    // ==========================
    // TIMELINE — built from real history rows
    // Defensive `|| []`: some DB helpers return null/undefined on a
    // driver-level hiccup rather than an empty array, which would
    // otherwise make every step look like "no history yet" even
    // when rows exist.
    // ==========================
    const historyRows =
      (await Select(
        `SELECT from_status, to_status, remarks, proof_photo_path, changed_by, created_at
           FROM shipment_tracking_history
          WHERE ticket_number = ?
          ORDER BY created_at ASC, id ASC`,
        [ticket],
      )) || [];

    let timeline = [];

    if (dispatch) {
      timeline.push({
        title: "Dispatched",
        desc: dispatch.driver_name
          ? `Assigned to ${dispatch.driver_name}${dispatch.vehicle_code ? " · " + dispatch.vehicle_code : ""}`
          : "Assigned for dispatch",
        time: dispatch.dispatch_date,
        // Only the very last step in the whole timeline should ever
        // read "current" / show the Live badge — Dispatched is
        // "done" the moment any later event exists.
        state: historyRows.length > 0 ? "done" : "current",
      });
    }

    historyRows.forEach((h, i) => {
      const isLast = i === historyRows.length - 1;
      timeline.push({
        title: h.to_status,
        desc: h.remarks || `${h.from_status ?? "—"} → ${h.to_status}`,
        time: h.created_at,
        state: isLast
          ? h.to_status === "Delivered" || h.to_status === "Cancelled"
            ? "done"
            : "current"
          : "done",
        proof_photo_path: h.proof_photo_path || null,
        changed_by: h.changed_by || null,
      });
    });

    // If there's a dispatch but no history yet at all (e.g. never
    // updated since being dispatched), show the current live status
    // as a "current" step so the UI isn't just a single dot.
    if (dispatch && historyRows.length === 0) {
      timeline.push({
        title: dispatch.dispatch_status || "Preparing",
        desc: dispatch.remarks || "Currently in progress.",
        time: null,
        state: "current",
      });
    }

    // ==========================
    // MILESTONE STEPPER — the same data, reshaped into one fixed
    // row: Dispatched / Picked / In Transit / Arrived / Delivered,
    // each with the earliest time it was reached (or "not yet" if it
    // hasn't happened). This is what renders as the horizontal
    // "form" of every status + its own timestamp, side-by-side,
    // instead of a scrolling list of cards.
    //
    // STATUS_TO_MILESTONE is what makes this correctly recognize
    // history rows written by EITHER surface — previously this
    // compared h.to_status directly against MILESTONE_ORDER labels
    // that used a different vocabulary ("Out for Delivery", "Picked
    // Up", etc.), so real transitions from the driver app never
    // registered here at all.
    // ==========================
    const milestoneTimes = {};
    if (dispatch) milestoneTimes["Dispatched"] = dispatch.dispatch_date;

    historyRows.forEach((h) => {
      const milestoneLabel = STATUS_TO_MILESTONE[h.to_status];
      // Keep the EARLIEST time a milestone was reached, in case a
      // shipment bounced back into the same status more than once.
      if (milestoneLabel && !milestoneTimes[milestoneLabel]) {
        milestoneTimes[milestoneLabel] = h.created_at;
      }
    });

    // A shipment that skipped straight from Dispatched to a later
    // status (e.g. Dispatched -> Delivered with no Picked / In
    // Transit logged) should show those skipped steps as "reached"
    // too, not stuck pending forever, since we know it must have
    // physically passed through them. Detected by: the milestone
    // after it in MILESTONE_ORDER was reached, but this one wasn't.
    const furthestReachedIndex = MILESTONE_ORDER.reduce(
      (acc, label, i) => (milestoneTimes[label] ? i : acc),
      -1,
    );

    const milestones = MILESTONE_ORDER.map((label, i) => {
      const reached = !!milestoneTimes[label];
      return {
        label,
        time: milestoneTimes[label] || null,
        reached,
        // "implied" = shipment is known to have passed this step
        // (a later step has a timestamp) even though this exact
        // status transition was never logged individually.
        implied: !reached && i < furthestReachedIndex,
      };
    });

    // Cancelled / Delayed don't fit the linear milestone strip, so
    // surface them as a separate flag instead of squeezing them in.
    const exceptionEvent = historyRows.find(
      (h) => h.to_status === "Cancelled" || h.to_status === "Delayed",
    );

    res.json({
      header: header[0],
      items,
      dispatch,
      timeline,
      milestones,
      exception: exceptionEvent
        ? {
            status: exceptionEvent.to_status,
            time: exceptionEvent.created_at,
            remarks: exceptionEvent.remarks,
          }
        : null,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Failed to load shipment.",
    });
  }
});

/* =====================================================
   MARK SINGLE SHIPMENT AS DELIVERED (with proof photo)
   Multipart form: proof_photo (file, optional), remarks (text)
   Identified by tracking_row_id (shipment_dispatch_items.id).
===================================================== */
router.post(
  "/mark-delivered/:trackingRowId",
  uploadProof.single("proof_photo"),
  async (req, res) => {
    try {
      const { trackingRowId } = req.params;
      const { remarks } = req.body;

      const existing = await Select(
        `SELECT id, ticket_number, status FROM shipment_dispatch_items WHERE id = ?`,
        [trackingRowId],
      );

      if (existing.length === 0) {
        return res.status(404).json({ message: "Shipment not found." });
      }

      const prevStatus = existing[0].status;
      const proofPath = req.file ? `/uploads/proof/${req.file.filename}` : null;

      await Update(
        `UPDATE shipment_dispatch_items
           SET status = 'Delivered',
               remarks = COALESCE(NULLIF(?, ''), remarks),
               delivered_at = COALESCE(delivered_at, NOW()),
               proof_photo_path = COALESCE(?, proof_photo_path)
         WHERE id = ?`,
        [remarks || "", proofPath, trackingRowId],
      );

      await logTrackingHistory({
        ticket_number: existing[0].ticket_number,
        tracking_row_id: trackingRowId,
        from_status: prevStatus,
        to_status: "Delivered",
        remarks: remarks || null,
        proof_photo_path: proofPath,
        changed_by: getChangedBy(req),
      });

      res.json({
        message: "Shipment marked as delivered.",
        proof_photo_path: proofPath,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        message: err.message?.includes("images are allowed")
          ? err.message
          : "Failed to mark shipment as delivered.",
      });
    }
  },
);

/* =====================================================
   BULK IMPORT — update tracking status/remarks for
   existing dispatched shipments, keyed by ticket_number.
   Rows for tickets with no dispatch record are skipped.
   Logs a history row for each row whose status actually changed.
===================================================== */
router.post("/bulk-import", async (req, res) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No rows provided." });
    }

    let updated = 0;
    const skipped = [];

    for (const row of rows) {
      const ticket = row.ticket_number;
      if (!ticket) continue;

      const existing = await Select(
        `SELECT id, status FROM shipment_dispatch_items WHERE ticket_number = ? LIMIT 1`,
        [ticket],
      );

      if (existing.length === 0) {
        skipped.push(ticket);
        continue;
      }

      const prevStatus = existing[0].status;
      const newStatus = row.status || prevStatus;

      await Update(
        `UPDATE shipment_dispatch_items
           SET status = COALESCE(NULLIF(?, ''), status),
               remarks = COALESCE(NULLIF(?, ''), remarks),
               delivered_at = CASE WHEN ? = 'Delivered' AND delivered_at IS NULL
                                    THEN NOW() ELSE delivered_at END
         WHERE ticket_number = ?`,
        [row.status || "", row.remarks || "", row.status || "", ticket],
      );

      if (row.status && row.status !== prevStatus) {
        await logTrackingHistory({
          ticket_number: ticket,
          tracking_row_id: existing[0].id,
          from_status: prevStatus,
          to_status: newStatus,
          remarks: row.remarks || null,
          changed_by: getChangedBy(req),
        });
      }

      updated++;
    }

    res.json({
      message: `${updated} shipment(s) updated.${skipped.length ? ` ${skipped.length} ticket(s) skipped (no dispatch record).` : ""}`,
      updated,
      skipped,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Bulk import failed." });
  }
});

/* =====================================================
   BULK STATUS UPDATE — update status/remarks for a set of
   shipment_dispatch_items rows selected via checkboxes in
   the UI, identified by their tracking_row_id (sdi.id).
   Logs one history row per shipment updated.
===================================================== */
router.put("/bulk-update-status", async (req, res) => {
  try {
    const { tracking_row_ids, status, remarks } = req.body;

    if (!Array.isArray(tracking_row_ids) || tracking_row_ids.length === 0) {
      return res.status(400).json({ message: "No shipments selected." });
    }
    if (!status || !VALID_TRACKING_STATUSES.includes(status)) {
      return res.status(400).json({ message: "A valid status is required." });
    }

    // Pull current ticket_number/status for each row BEFORE overwriting,
    // so we know the from -> to transition to log per shipment.
    const currentRows = await Select(
      `SELECT id, ticket_number, status FROM shipment_dispatch_items WHERE id IN (?)`,
      [tracking_row_ids],
    );

    await Update(
      `UPDATE shipment_dispatch_items
         SET status = ?,
             remarks = COALESCE(NULLIF(?, ''), remarks),
             delivered_at = CASE WHEN ? = 'Delivered' AND delivered_at IS NULL
                                  THEN NOW() ELSE delivered_at END
       WHERE id IN (?)`,
      [status, remarks || "", status, tracking_row_ids],
    );

    const changedBy = getChangedBy(req);

    for (const row of currentRows) {
      await logTrackingHistory({
        ticket_number: row.ticket_number,
        tracking_row_id: row.id,
        from_status: row.status,
        to_status: status,
        remarks: remarks || null,
        changed_by: changedBy,
      });
    }

    res.json({
      message: `${tracking_row_ids.length} shipment(s) updated to "${status}".`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Bulk status update failed." });
  }
});

module.exports = router;
