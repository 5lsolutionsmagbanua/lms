var express = require("express");
var router = express.Router();
var multer = require("multer");
var path = require("path");
var fs = require("fs");
const { fileTypeFromFile } = require("file-type");

const { Select, Update } = require("../repository/dbconnection");
const { logTrackingHistory } = require("../repository/trackingHistory");

const { requireRole, getChangedBy } = require("../middleware/auth");
const { setDriverAvailability } = require("./driverRegistration");
const { setVehicleAvailability } = require("./vehicle");

/* =====================================================
   DISPATCH -> SHIPMENT REQUEST STATUS MAPPING
===================================================== */
const DISPATCH_TO_REQUEST_STATUS = {
  Preparing: "Dispatched",
  Picked: "Dispatched",
  "In Transit": "Dispatched",
  Arrived: "Dispatched",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
};
const VALID_DISPATCH_STATUSES = Object.keys(DISPATCH_TO_REQUEST_STATUS);
const ACTIVE_DISPATCH_STATUSES = [
  "Preparing",
  "Picked",
  "In Transit",
  "Arrived",
];
const PENDING_DISPATCH_STATUSES = ACTIVE_DISPATCH_STATUSES.filter(
  (s) => s !== "In Transit",
);

/* =====================================================
   MAX PROOF PHOTOS PER TICKET
===================================================== */
const MAX_PROOF_PHOTOS = 5;
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

/* =====================================================
   RESOLVE DRIVER ID FROM SESSION
   (single source of truth — req.user is populated from
   req.session.user by the attachUser middleware, so this
   always reflects the logged-in driver's session.)
===================================================== */
async function resolveDriverId(req) {
  const sessionUser = req.user;
  if (!sessionUser) return null;

  const rows = await Select(
    `SELECT id FROM drivers WHERE user_id = ? LIMIT 1`,
    [sessionUser.id],
  );

  return rows.length > 0 ? rows[0].id : null;
}

/* =====================================================
   PHOTO UPLOAD STORAGE
===================================================== */
const uploadDir = path.join(__dirname, "..", "public", "uploads", "proofs");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // dispatch_item_id is attacker-controlled (form field) and was
    // previously interpolated straight into the filename. Restrict
    // it to digits only here; the route handler also rejects the
    // request outright if it isn't a plain integer, so this is a
    // defense-in-depth fallback rather than the primary check.
    const rawId = req.body.dispatch_item_id;
    const safeId = /^\d+$/.test(String(rawId)) ? rawId : "unknown";

    // file.mimetype/originalname are also client-supplied, so don't
    // trust the extension blindly either — allowlist it.
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : ".jpg";

    const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    cb(null, `photo_${safeId}_${unique}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // NOTE: this only checks the client-supplied Content-Type header,
    // which is trivially spoofable. It's a cheap first-pass filter —
    // the real check is verifyIsImage() below, run on the saved
    // file's actual bytes after upload.
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed for proof photo."));
    }
    cb(null, true);
  },
});

/* =====================================================
   HELPERS
===================================================== */

// Deletes any files multer already wrote to disk for this request.
// Used whenever we reject a request *after* multer has run (bad
// ownership, invalid ID, failed image verification) so we don't
// leak orphaned files into public/uploads/proofs.
function cleanupUploadedFiles(req) {
  if (req.files && req.files.length) {
    req.files.forEach((f) => fs.unlink(f.path, () => {}));
  }
}

// Verifies a file's actual bytes are an image, not just its claimed
// mimetype/extension. Returns true/false per file; caller decides
// what to do with failures.
async function verifyIsImage(filepath) {
  try {
    const type = await fileTypeFromFile(filepath);
    return !!(type && type.mime.startsWith("image/"));
  } catch {
    return false;
  }
}

/* =====================================================
   ROOT + DASHBOARD PAGE
===================================================== */
router.get("/", requireRole("Driver"), (req, res) => {
  res.render("driverDashboard", {
    title: "My Deliveries",
    user: req.user,
  });
});

router.get("/dashboard", requireRole("Driver"), (req, res) => {
  res.render("driverDashboard", {
    title: "My Deliveries",
    user: req.user,
  });
});

/* =====================================================
   GET MY DELIVERIES (summary cards + card list)

   Each row here is now ONE TICKET (one shipment_dispatch_items
   row), not one dispatch batch — selecting 2 shipments in a bulk
   assign now shows 2 independent cards. dispatch_number/driver/
   vehicle are shared context, but status/completion is tracked
   per item.
===================================================== */
router.get("/my-deliveries", requireRole("Driver"), async (req, res) => {
  try {
    const driverId = await resolveDriverId(req);

    if (!driverId) {
      return res.status(401).json({ message: "Not authenticated." });
    }

    const summaryRows = await Select(
      `
      SELECT
        SUM(CASE WHEN DATE(sd.dispatch_date) = CURDATE()
                  AND sdi.status NOT IN ('Delivered', 'Cancelled') THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN sdi.status IN (?) THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN sdi.status = 'In Transit' THEN 1 ELSE 0 END) AS in_transit,
        SUM(CASE WHEN sdi.status = 'Delivered'
                  AND DATE(sdi.delivered_at) = CURDATE() THEN 1 ELSE 0 END) AS completed
      FROM shipment_dispatch_items sdi
      INNER JOIN shipment_dispatch sd ON sdi.dispatch_id = sd.id
      WHERE sd.driver_id = ?
      `,
      [PENDING_DISPATCH_STATUSES, driverId],
    );

    const deliveries = await Select(
      `
      SELECT
        sdi.id AS dispatch_item_id,
        sdi.dispatch_id,
        sd.dispatch_number,
        sdi.status,
        sdi.ticket_number,
        sr.priority,
        s.store_name,
        s.store_address AS store_address,
        s.contact_number
      FROM shipment_dispatch_items sdi
      INNER JOIN shipment_dispatch sd ON sdi.dispatch_id = sd.id
      INNER JOIN shipment_requests sr ON sr.ticket_number = sdi.ticket_number
      INNER JOIN stores s ON sr.store_id = s.id
      WHERE sd.driver_id = ?
        AND sdi.status NOT IN ('Delivered', 'Cancelled')
      GROUP BY sdi.id, sdi.dispatch_id, sd.dispatch_number, sdi.status,
               sdi.ticket_number, sr.priority, s.store_name, s.store_address, s.contact_number
      ORDER BY
        FIELD(sr.priority, 'Urgent', 'High', 'Normal', 'Low'),
        sd.dispatch_date ASC
      `,
      [driverId],
    );

    res.json({
      summary: summaryRows[0] || {
        today: 0,
        pending: 0,
        in_transit: 0,
        completed: 0,
      },
      deliveries,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load deliveries." });
  }
});

/* =====================================================
   GET SINGLE DELIVERY (one ticket) — header + items

   Keyed on dispatch_item_id (shipment_dispatch_items.id), not
   dispatch_id — the driver is completing ONE ticket here, even
   though it may share a dispatch_number/driver/vehicle with other
   tickets in the same batch.
===================================================== */
router.get("/delivery/:itemId", requireRole("Driver"), async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!/^\d+$/.test(String(itemId))) {
      return res.status(400).json({ message: "Invalid delivery ID." });
    }

    const driverId = await resolveDriverId(req);

    if (!driverId) {
      return res.status(401).json({ message: "Not authenticated." });
    }

    const headerRows = await Select(
      `
      SELECT
        sdi.id AS dispatch_item_id,
        sdi.dispatch_id,
        sdi.ticket_number,
        sdi.status,
        sdi.remarks,
        sd.dispatch_number,
        sr.priority,
        t.type_name AS request_type,
        s.store_name,
        s.store_address AS store_address,
        s.contact_number
      FROM shipment_dispatch_items sdi
      INNER JOIN shipment_dispatch sd ON sdi.dispatch_id = sd.id
      INNER JOIN shipment_requests sr ON sr.ticket_number = sdi.ticket_number
      INNER JOIN stores s ON sr.store_id = s.id
      LEFT JOIN types t ON sr.type_id = t.id
      WHERE sdi.id = ?
        AND sd.driver_id = ?
      `,
      [itemId, driverId],
    );

    if (headerRows.length === 0) {
      return res.status(404).json({ message: "Delivery not found." });
    }

    const header = headerRows[0];

    const items = await Select(
      `
      SELECT
        sr.type_id,
        t.type_name,
        sr.product_id,
        p.inventory_name AS product_name,
        sr.unit_id,
        u.unit_name,
        sr.quantity
      FROM shipment_requests sr
      INNER JOIN products p ON sr.product_id = p.id
      LEFT JOIN units u ON sr.unit_id = u.id
      LEFT JOIN types t ON sr.type_id = t.id
      WHERE sr.ticket_number = ?
      ORDER BY sr.shipment_id ASC
      `,
      [header.ticket_number],
    );

    res.json({ header, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load delivery details." });
  }
});

/* =====================================================
   COMPLETE / UPDATE DELIVERY STATUS (per ticket)

   Updates ONLY the one shipment_dispatch_items row (and its
   shipment_requests row) the driver is acting on. The driver and
   vehicle are released back to Available only once every item in
   the parent dispatch batch has reached a terminal status
   (Delivered/Cancelled) — so with 2 shipments assigned together,
   both must be completed before the driver/vehicle free up.

   proof_photo_path stores a JSON array of paths (up to
   MAX_PROOF_PHOTOS), since a ticket can have multiple proof
   photos. Any code reading this column elsewhere must
   JSON.parse() it and render a gallery instead of a single <img>.
   Marking a ticket "Delivered" requires at least one proof photo.

   TRACKING SYNC (new): every status change made here also writes a
   row to shipment_tracking_history via the shared
   logTrackingHistory() helper — the same helper shipmentTracking.js
   uses for its own mark-delivered / bulk-import / bulk-update-status
   routes. Without this, a driver moving a ticket through
   Picked -> In Transit -> Arrived -> Delivered from the mobile app
   would never show up on the admin Tracking page's milestone strip
   or timeline (those are built entirely from shipment_tracking_history
   rows, not from shipment_dispatch_items.status directly). We fetch
   the item's CURRENT status before overwriting it so we can log a
   real from_status -> to_status transition, exactly like the admin
   bulk-update-status route does.

   Security notes vs. the original version:
   - dispatch_item_id is validated as a plain integer before
     anything else runs.
   - Ownership is still checked after multer (files must land on
     disk before we know the ticket_number to query against), so
     any rejection path below now cleans up uploaded files via
     cleanupUploadedFiles() to avoid orphaned files on disk from
     requests referencing deliveries the driver doesn't own.
   - Each uploaded file's actual bytes are verified as an image
     (verifyIsImage) after upload, since fileFilter's mimetype
     check is client-controlled and spoofable. Files that fail are
     deleted and the request rejected — this matters because the
     upload directory is served statically under /public.
===================================================== */
router.post(
  "/complete",
  requireRole("Driver"),
  upload.array("photos", MAX_PROOF_PHOTOS),
  async (req, res) => {
    try {
      const { dispatch_item_id, status, remarks } = req.body;

      if (!dispatch_item_id || !/^\d+$/.test(String(dispatch_item_id))) {
        cleanupUploadedFiles(req);
        return res.status(400).json({
          success: false,
          message: "A valid delivery ID is required.",
        });
      }

      if (!status || !VALID_DISPATCH_STATUSES.includes(status)) {
        cleanupUploadedFiles(req);
        return res.status(400).json({
          success: false,
          message: "A valid status is required.",
        });
      }

      const driverId = await resolveDriverId(req);

      if (!driverId) {
        cleanupUploadedFiles(req);
        return res
          .status(401)
          .json({ success: false, message: "Not authenticated." });
      }

      // NOTE: sdi.status is now selected too, as prevStatus — this is
      // the "from" side of the tracking-history transition we log
      // below, captured BEFORE the UPDATE overwrites it.
      const owned = await Select(
        `
        SELECT sdi.id, sdi.dispatch_id, sdi.ticket_number, sdi.status AS prev_status,
               sd.driver_id, sd.vehicle_id
        FROM shipment_dispatch_items sdi
        INNER JOIN shipment_dispatch sd ON sdi.dispatch_id = sd.id
        WHERE sdi.id = ? AND sd.driver_id = ?
        `,
        [dispatch_item_id, driverId],
      );

      if (owned.length === 0) {
        // Ticket doesn't belong to this driver — discard anything
        // multer already wrote before we knew that.
        cleanupUploadedFiles(req);
        return res.status(404).json({
          success: false,
          message: "Delivery not found.",
        });
      }

      const { dispatch_id, ticket_number, vehicle_id, prev_status } = owned[0];

      let photoPaths = null; // JSON string of one or more paths

      if (status === "Delivered") {
        if (!req.files || !req.files.length) {
          return res.status(400).json({
            success: false,
            message:
              "At least one delivery photo is required to mark as delivered.",
          });
        }

        // Verify each uploaded file is actually an image by its
        // bytes, not just its claimed mimetype/extension.
        const verifications = await Promise.all(
          req.files.map((f) => verifyIsImage(f.path)),
        );
        const allValid = verifications.every(Boolean);

        if (!allValid) {
          cleanupUploadedFiles(req);
          return res.status(400).json({
            success: false,
            message: "One or more uploaded files are not valid images.",
          });
        }

        photoPaths = JSON.stringify(
          req.files.map((f) => `/uploads/proofs/${f.filename}`),
        );
      } else {
        // Not a Delivered status — any photos attached to a
        // non-delivered submission aren't expected; discard them
        // rather than leaving them on disk unreferenced.
        cleanupUploadedFiles(req);
      }

      const trimmedRemarks = (remarks || "").slice(0, 500);

      // ======================================
      // UPDATE THIS ITEM ONLY
      // ======================================
      await Update(
        `
        UPDATE shipment_dispatch_items
        SET
          status = ?,
          remarks = ?,
          proof_photo_path = COALESCE(?, proof_photo_path),
          delivered_at = CASE WHEN ? = 'Delivered' THEN NOW() ELSE delivered_at END
        WHERE id = ?
        `,
        [status, trimmedRemarks, photoPaths, status, dispatch_item_id],
      );

      // ======================================
      // LOG THE TRANSITION FOR TRACKING
      // Fires on every status change, not just Delivered — this is
      // what makes the driver app's Picked/In Transit/Arrived taps
      // show up on the admin Tracking page's milestone strip and
      // timeline with a real recorded time, same as a manual
      // bulk-update-status from the Tracking page would.
      // ======================================
      await logTrackingHistory({
        ticket_number,
        tracking_row_id: dispatch_item_id,
        from_status: prev_status,
        to_status: status,
        remarks: trimmedRemarks || null,
        proof_photo_path: photoPaths,
        changed_by: getChangedBy(req),
      });

      const requestStatus = DISPATCH_TO_REQUEST_STATUS[status];

      await Update(
        `
        UPDATE shipment_requests
        SET status = ?, updated_at = NOW()
        WHERE ticket_number = ?
        `,
        [requestStatus, ticket_number],
      );

      // ======================================
      // CHECK IF THE WHOLE BATCH IS NOW DONE
      // Only release the driver/vehicle once every ticket in this
      // dispatch_id has reached Delivered or Cancelled.
      // ======================================
      const remaining = await Select(
        `
        SELECT COUNT(*) AS cnt
        FROM shipment_dispatch_items
        WHERE dispatch_id = ?
          AND status NOT IN ('Delivered', 'Cancelled')
        `,
        [dispatch_id],
      );

      const batchComplete = remaining[0].cnt === 0;

      if (batchComplete) {
        const allItems = await Select(
          `SELECT status FROM shipment_dispatch_items WHERE dispatch_id = ?`,
          [dispatch_id],
        );
        // Batch-level status: Delivered if at least one item actually
        // delivered, otherwise every item was cancelled.
        const overallStatus = allItems.some((r) => r.status === "Delivered")
          ? "Delivered"
          : "Cancelled";

        await Update(
          `
          UPDATE shipment_dispatch
          SET
            status = ?,
            delivered_at = CASE WHEN ? = 'Delivered' THEN NOW() ELSE delivered_at END,
            updated_at = NOW()
          WHERE id = ?
          `,
          [overallStatus, overallStatus, dispatch_id],
        );

        console.log(
          `[driverDashboard] All ${allItems.length} ticket(s) in dispatch ${dispatch_id} are terminal. Releasing driver ${driverId} and vehicle ${vehicle_id} back to Available.`,
        );

        await setDriverAvailability(driverId, "Available");

        if (vehicle_id) {
          await setVehicleAvailability(vehicle_id, "Available");
        }
      } else {
        console.log(
          `[driverDashboard] Ticket ${ticket_number} -> ${status}. ${remaining[0].cnt} ticket(s) still active in dispatch ${dispatch_id} — driver/vehicle stay reserved.`,
        );
      }

      res.json({
        success: true,
        message:
          status === "Delivered"
            ? batchComplete
              ? "Delivery completed. All shipments in this run are done."
              : "Delivery completed. Other shipments in this run are still pending."
            : "Delivery status updated.",
      });
    } catch (err) {
      console.error(err);
      cleanupUploadedFiles(req);
      res.status(500).json({
        success: false,
        message: err.message || "Failed to update delivery.",
      });
    }
  },
);

module.exports = router;
