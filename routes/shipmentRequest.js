var express = require("express");
var router = express.Router();
const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");

/* GET home page. */
router.get("/", function (req, res, next) {
  res.render("shipmentRequest", { title: "Shipments Page" });
});

/* =====================================================
   LOAD SHIPMENTS (list/table view)
   is_assigned now checks shipment_dispatch_items (the new
   join table), not shipment_dispatch directly — a ticket is
   "assigned" once ANY of its items belong to a dispatch batch.
===================================================== */
router.get("/get-shipments", async (req, res) => {
  try {
    const sql = `
      SELECT

        MIN(sr.shipment_id) AS shipment_id,
        sr.ticket_number,
        MAX(sr.barcode) AS barcode,

        s.store_name,
        s.store_code,

        COUNT(*) AS total_items,

        sr.priority,
        sr.status,

        MAX(sr.created_at) AS created_at,

        CASE
          WHEN MAX(sdi.id) IS NULL THEN 0
          ELSE 1
        END AS is_assigned

      FROM shipment_requests sr

      INNER JOIN stores s
        ON sr.store_id = s.id

      LEFT JOIN shipment_dispatch_items sdi
        ON sr.ticket_number = sdi.ticket_number

      GROUP BY

        sr.ticket_number,
        s.store_name,
        s.store_code,
        sr.store_id,
        sr.priority,
        sr.status

      ORDER BY
        shipment_id DESC
    `;

    const rows = await Select(sql);

    res.json(rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Failed to load shipments.",
    });
  }
});

// ================================
// GET AVAILABLE DRIVERS
// ================================
router.get("/drivers/list", async (req, res) => {
  try {
    const rows = await Select(`
      SELECT
          id,
          driver_code,
          CONCAT(first_name,' ',last_name) AS driver_name,
          availability_status
      FROM drivers
      WHERE
          is_active = 1
          AND attendance_status = 'Present'
          AND (
              availability_status IN ('Available', 'Assigned')
              OR availability_status IS NULL
              OR availability_status = ''
          )
      ORDER BY first_name,last_name
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Failed to load drivers.",
    });
  }
});

router.get("/vehicles/list", async (req, res) => {
  try {
    const vehicles = await Select(`
      SELECT
          v.id,
          v.vehicle_code,
          v.plate_number,
          v.driver_id,
          CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
          d.driver_code
      FROM vehicles v
      LEFT JOIN drivers d
        ON v.driver_id = d.id
      WHERE v.status = 'Available'
      ORDER BY v.vehicle_code
    `);

    res.json(vehicles);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Unable to load vehicles.",
    });
  }
});

/* =====================================================
   GET SINGLE SHIPMENT (header + items + dispatch)
===================================================== */
router.get("/get-shipment/:ticket", async (req, res) => {
  try {
    const { ticket } = req.params;

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

    const dispatchSql = `
  SELECT

    sd.id AS dispatch_id,
    sd.dispatch_number,

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
    let dispatch = dispatchRows.length ? dispatchRows[0] : null;

    if (dispatch) {
      const batchTickets = await Select(
        `SELECT ticket_number FROM shipment_dispatch_items WHERE dispatch_id = ?`,
        [dispatch.dispatch_id],
      );
      dispatch.batch_tickets = batchTickets.map((r) => r.ticket_number);
    }

    res.json({
      header: header[0],
      items,
      dispatch,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Failed to load shipment.",
    });
  }
});

/* =====================================================
   LOAD TYPES / BRANCHES / STORES / UNITS / PRODUCTS
===================================================== */
router.get("/get-types", async (req, res) => {
  try {
    const sql = `
      SELECT id,type_name
      FROM types
      WHERE status='active'
      ORDER BY type_name
    `;
    res.json(await Select(sql));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load types." });
  }
});

router.get("/get-branches", async (req, res) => {
  try {
    const rows = await Select(`
      SELECT id, branch_name
      FROM branches
      WHERE status = 'active'
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load branches." });
  }
});

router.get("/get-stores", async (req, res) => {
  try {
    const rows = await Select(`
      SELECT id, store_name, store_code
      FROM stores
      WHERE is_active = 1
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load stores." });
  }
});

router.get("/get-units", async (req, res) => {
  try {
    const sql = `
      SELECT
      id,
      unit_name
      FROM units
      WHERE status='active'
      ORDER BY unit_name
    `;
    res.json(await Select(sql));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load units." });
  }
});

router.get("/get-products", async (req, res) => {
  try {
    const sql = `
      SELECT
        id,
        inventory_name,
        type_id,
        status
      FROM products
    `;
    const rows = await Select(sql);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/* =====================================================
   ADD SHIPMENT
===================================================== */
router.post("/add-shipment", async (req, res) => {
  try {
    const data = req.body;

    if (!data.ticket_number) {
      return res.status(400).json({
        success: false,
        message: "Ticket number is required.",
      });
    }
    if (!data.store_id) {
      return res.status(400).json({
        success: false,
        message: "Please select a store.",
      });
    }
    if (!data.priority) {
      return res.status(400).json({
        success: false,
        message: "Please select a priority.",
      });
    }
    if (!data.items || data.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please add at least one item.",
      });
    }

    let firstShipmentId = null;

    // TODO: wrap this loop in a DB transaction so a failure partway
    // through doesn't leave a partially-saved shipment.
    for (const item of data.items) {
      if (!item.productId || !item.unitId || Number(item.quantity) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid shipment item detected.",
        });
      }

      const result = await Insert(
        `
        INSERT INTO shipment_requests
        (
            ticket_number,
            type_id,
            store_id,
            product_id,
            unit_id,
            quantity,
            priority,
            notes,
            status
        )
        VALUES (?,?,?,?,?,?,?,?,?)
        `,
        [
          data.ticket_number,
          item.typeId,
          data.store_id,
          item.productId,
          item.unitId,
          item.quantity,
          data.priority,
          data.notes || "",
          "Pending",
        ],
      );

      if (!firstShipmentId) {
        firstShipmentId = result.insertId;
      }
    }

    const year = new Date().getFullYear();
    const dispatchNumber = `DSP-${year}-${String(firstShipmentId).padStart(6, "0")}`;
    const barcode = `SHP-${String(firstShipmentId).padStart(6, "0")}`;

    await Update(
      "UPDATE shipment_requests SET barcode = ? WHERE shipment_id = ?",
      [barcode, firstShipmentId],
    );

    res.json({
      success: true,
      message: "Shipment Request saved successfully.",

      shipment: {
        shipment_id: firstShipmentId,
        ticket_number: data.ticket_number,
        dispatch_number: dispatchNumber,
        priority: data.priority,
        store_id: data.store_id,
        status: "Pending",
      },
    });
  } catch (err) {
    console.error("========== ADD SHIPMENT ERROR ==========");
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Unable to save shipment.",
    });
  }
});

/* =====================================================
   UPDATE SHIPMENT
===================================================== */
router.put("/update-shipment", async (req, res) => {
  try {
    const { shipment_id, store_id, priority, status, notes, items } = req.body;

    if (!shipment_id)
      return res
        .status(400)
        .json({ success: false, message: "Shipment ID is required." });
    if (!store_id)
      return res
        .status(400)
        .json({ success: false, message: "Store is required." });
    if (!priority)
      return res
        .status(400)
        .json({ success: false, message: "Priority is required." });
    if (!status)
      return res
        .status(400)
        .json({ success: false, message: "Status is required." });
    if (!items || items.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Please add at least one item." });

    const invalidItem = items.find(
      (item) =>
        !(item.productId ?? item.product_id) ||
        !(item.unitId ?? item.unit_id) ||
        Number(item.quantity) <= 0,
    );
    if (invalidItem)
      return res
        .status(400)
        .json({ success: false, message: "Invalid shipment item detected." });

    const shipment = await Select(
      `SELECT ticket_number FROM shipment_requests WHERE shipment_id = ? LIMIT 1`,
      [shipment_id],
    );
    if (shipment.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Shipment not found." });

    const ticket_number = shipment[0].ticket_number;

    const existingRows = await Select(
      `SELECT shipment_id FROM shipment_requests WHERE ticket_number = ? ORDER BY shipment_id ASC`,
      [ticket_number],
    );
    const existingIds = existingRows.map((r) => r.shipment_id);

    const dispatched = await Select(
      `SELECT shipment_id FROM shipment_dispatch_items WHERE shipment_id IN (?)`,
      [existingIds.length ? existingIds : [0]],
    );
    const protectedIds = new Set(dispatched.map((r) => r.shipment_id));

    const maxLen = Math.max(items.length, existingIds.length);

    for (let i = 0; i < maxLen; i++) {
      const item = items[i];
      const existingId = existingIds[i];

      if (item && existingId) {
        await Update(
          `UPDATE shipment_requests
             SET type_id = ?, store_id = ?, product_id = ?, unit_id = ?,
                 quantity = ?, priority = ?, notes = ?, status = ?
           WHERE shipment_id = ?`,
          [
            item.typeId ?? item.type_id,
            store_id,
            item.productId ?? item.product_id,
            item.unitId ?? item.unit_id,
            item.quantity,
            priority,
            notes,
            status,
            existingId,
          ],
        );
      } else if (item && !existingId) {
        await Insert(
          `INSERT INTO shipment_requests
             (ticket_number, type_id, store_id, product_id, unit_id, quantity, priority, notes, status)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            ticket_number,
            item.typeId ?? item.type_id,
            store_id,
            item.productId ?? item.product_id,
            item.unitId ?? item.unit_id,
            item.quantity,
            priority,
            notes,
            status,
          ],
        );
      } else if (!item && existingId) {
        if (protectedIds.has(existingId)) {
          return res.status(409).json({
            success: false,
            message:
              "Cannot remove an item that is already assigned to a dispatch. Unassign the dispatch first.",
          });
        }
        await Delete(`DELETE FROM shipment_requests WHERE shipment_id = ?`, [
          existingId,
        ]);
      }
    }

    res.json({ success: true, message: "Shipment updated successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =====================================================
   APPROVE SHIPMENT
   Only allowed while status is "Pending". Applies to every
   item row under this ticket_number at once.
===================================================== */
router.put("/approve-shipment/:ticket", async (req, res) => {
  try {
    const { ticket } = req.params;

    const rows = await Select(
      `SELECT shipment_id, status FROM shipment_requests WHERE ticket_number = ?`,
      [ticket],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shipment not found.",
      });
    }

    const notPending = rows.find((r) => r.status !== "Pending");
    if (notPending) {
      return res.status(409).json({
        success: false,
        message: `Cannot approve — this shipment is already "${notPending.status}".`,
      });
    }

    await Update(
      `UPDATE shipment_requests SET status = 'Approved' WHERE ticket_number = ?`,
      [ticket],
    );

    res.json({ success: true, message: "Shipment approved." });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Unable to approve shipment." });
  }
});

/* =====================================================
   REJECT SHIPMENT  (NEW)
   Mirrors approve-shipment: only allowed while status is
   "Pending", applies to every item row under the ticket at
   once. Used by the Edit modal's Approve/Reject step — once
   a shipment has been saved, opening it again offers Approve
   (-> Assign Driver & Vehicle) or Reject (-> status Rejected)
   instead of the item-editing form.
===================================================== */
router.put("/reject-shipment/:ticket", async (req, res) => {
  try {
    const { ticket } = req.params;

    const rows = await Select(
      `SELECT shipment_id, status FROM shipment_requests WHERE ticket_number = ?`,
      [ticket],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shipment not found.",
      });
    }

    const notPending = rows.find((r) => r.status !== "Pending");
    if (notPending) {
      return res.status(409).json({
        success: false,
        message: `Cannot reject — this shipment is already "${notPending.status}".`,
      });
    }

    await Update(
      `UPDATE shipment_requests SET status = 'Rejected' WHERE ticket_number = ?`,
      [ticket],
    );

    res.json({ success: true, message: "Shipment rejected." });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Unable to reject shipment." });
  }
});

/* =====================================================
   DELETE SHIPMENT
   NOTE: the UI no longer exposes a delete button (removed per
   request), but the route itself is left in place — it's still
   correctly guarded against deleting a dispatched shipment, and
   removing a working, harmless endpoint isn't worth the risk of
   breaking something else that might call it directly.
===================================================== */
router.delete("/delete-shipment/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const dispatched = await Select(
      `SELECT dispatch_id FROM shipment_dispatch_items WHERE shipment_id = ? LIMIT 1`,
      [id],
    );

    if (dispatched.length > 0) {
      return res.status(409).json({
        message:
          "This shipment has already been dispatched and cannot be deleted.",
      });
    }

    await Delete(
      `
      DELETE FROM shipment_requests
      WHERE shipment_id = ?
      `,
      [id],
    );

    res.json({
      message: "Shipment deleted successfully.",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Unable to delete shipment.",
    });
  }
});

module.exports = router;
