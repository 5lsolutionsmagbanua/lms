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
  res.render("shipmentDispatch", { title: "Express" });
});

router.post("/assign", async (req, res) => {
  let driverReserved = false;
  let vehicleReserved = false;
  let originalDriverStatus = "Available";
  let originalVehicleStatus = "Available";

  try {
    const data = req.body;

    // Normalize: single-assign modals still send shipment_id; bulk-assign
    // now sends shipment_ids (array). Backward compatible either way.
    const shipmentIds = Array.isArray(data.shipment_ids)
      ? data.shipment_ids
      : data.shipment_id
        ? [data.shipment_id]
        : [];

    if (
      shipmentIds.length === 0 ||
      !data.dispatch_number ||
      !data.driver_id ||
      !data.vehicle_id ||
      !data.dispatch_date
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields.",
      });
    }

    // ======================================
    // GET SHIPMENTS (one row per ticket)
    // ======================================
    const shipments = await Select(
      `
      SELECT shipment_id, ticket_number, status
      FROM shipment_requests
      WHERE shipment_id IN (?)
      `,
      [shipmentIds],
    );

    if (shipments.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shipment(s) not found.",
      });
    }

    const nonAssignableStatuses = ["Delivered", "Cancelled"];
    const blocked = shipments.find((s) =>
      nonAssignableStatuses.includes(s.status),
    );
    if (blocked) {
      return res.status(400).json({
        success: false,
        message: `Ticket ${blocked.ticket_number} is ${blocked.status} and cannot be assigned.`,
      });
    }

    const ticketNumbers = [...new Set(shipments.map((s) => s.ticket_number))];

    // ======================================
    // CHECK NONE OF THESE TICKETS ARE ALREADY ASSIGNED
    // (was: check shipment_dispatch directly; now checks the items table,
    // since a ticket can only belong to one dispatch batch at a time)
    // ======================================
    const existingDispatch = await Select(
      `
      SELECT DISTINCT ticket_number
      FROM shipment_dispatch_items
      WHERE ticket_number IN (?)
      `,
      [ticketNumbers],
    );

    if (existingDispatch.length > 0) {
      const already = existingDispatch.map((r) => r.ticket_number).join(", ");
      return res.status(400).json({
        success: false,
        message: `Ticket(s) ${already} have already been assigned.`,
      });
    }

    // ======================================
    // CHECK DRIVER ISN'T ALREADY ON AN ACTIVE DISPATCH
    // ======================================
    const activeDriverDispatch = await Select(
      `
      SELECT ticket_number, dispatch_number
      FROM shipment_dispatch
      WHERE driver_id = ?
        AND status NOT IN ('Delivered', 'Cancelled')
      LIMIT 1
      `,
      [data.driver_id],
    );

    if (activeDriverDispatch.length > 0) {
      return res.status(400).json({
        success: false,
        message: `This driver is already assigned to an active delivery (Ticket ${activeDriverDispatch[0].ticket_number}).`,
      });
    }

    // ======================================
    // CHECK VEHICLE ISN'T ALREADY ON AN ACTIVE DISPATCH
    // ======================================
    const activeVehicleDispatch = await Select(
      `
      SELECT ticket_number, dispatch_number
      FROM shipment_dispatch
      WHERE vehicle_id = ?
        AND status NOT IN ('Delivered', 'Cancelled')
      LIMIT 1
      `,
      [data.vehicle_id],
    );

    if (activeVehicleDispatch.length > 0) {
      return res.status(400).json({
        success: false,
        message: `This vehicle is already assigned to an active delivery (Ticket ${activeVehicleDispatch[0].ticket_number}).`,
      });
    }

    // ======================================
    // RESERVE DRIVER
    // ======================================
    const driverRow = await Select(
      `
      SELECT availability_status
      FROM drivers
      WHERE id = ? AND is_active = 1
      LIMIT 1
      `,
      [data.driver_id],
    );

    if (driverRow.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Selected driver is unavailable.",
      });
    }

    originalDriverStatus = driverRow[0].availability_status || "Available";

    const driverUpdate = await Update(
      `
      UPDATE drivers
      SET availability_status = 'Delivering', updated_at = NOW()
      WHERE id = ?
        AND is_active = 1
        AND (
            availability_status IN ('Available', 'Assigned')
            OR availability_status IS NULL
            OR availability_status = ''
        )
      `,
      [data.driver_id],
    );

    if (!driverUpdate || driverUpdate.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "Selected driver is unavailable.",
      });
    }
    driverReserved = true;

    // ======================================
    // RESERVE VEHICLE
    // ======================================
    const vehicleRow = await Select(
      `SELECT status FROM vehicles WHERE id = ? LIMIT 1`,
      [data.vehicle_id],
    );

    if (vehicleRow.length === 0) {
      await releaseDriver(data.driver_id, originalDriverStatus);
      driverReserved = false;
      return res.status(400).json({
        success: false,
        message: "Selected vehicle is unavailable.",
      });
    }

    originalVehicleStatus = vehicleRow[0].status || "Available";

    const vehicleUpdate = await Update(
      `
      UPDATE vehicles
      SET status = 'Assigned', updated_at = NOW()
      WHERE id = ? AND status = 'Available'
      `,
      [data.vehicle_id],
    );

    if (!vehicleUpdate || vehicleUpdate.affectedRows === 0) {
      await releaseDriver(data.driver_id, originalDriverStatus);
      driverReserved = false;
      return res.status(400).json({
        success: false,
        message: "Selected vehicle is unavailable.",
      });
    }
    vehicleReserved = true;

    // ======================================
    // SAVE DISPATCH (one row for the whole batch)
    // ======================================
    const result = await Insert(
      `
      INSERT INTO shipment_dispatch
      (
          shipment_id, ticket_number, dispatch_number, driver_id, vehicle_id,
          helper_name, dispatch_date, estimated_delivery, remarks, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Preparing')
      `,
      [
        shipments[0].shipment_id,
        shipments[0].ticket_number,
        data.dispatch_number,
        data.driver_id,
        data.vehicle_id,
        data.helper_name || null,
        data.dispatch_date,
        data.estimated_delivery || null,
        data.remarks || null,
      ],
    );

    const dispatchId = result.insertId;

    // ======================================
    // SAVE DISPATCH ITEMS (one row per shipment/ticket in the batch)
    // TODO: same transaction caveat as before — if the process dies
    // partway through this loop, some tickets end up linked to the
    // dispatch and others don't. Wrap in a real transaction once
    // dbconnection.js exposes one.
    // ======================================
    for (const s of shipments) {
      await Insert(
        `
        INSERT INTO shipment_dispatch_items (dispatch_id, shipment_id, ticket_number)
        VALUES (?, ?, ?)
        `,
        [dispatchId, s.shipment_id, s.ticket_number],
      );
    }

    // ======================================
    // UPDATE SHIPMENT STATUS FOR EVERY TICKET IN THE BATCH
    // ======================================
    await Update(
      `
      UPDATE shipment_requests
      SET status = 'Preparing', updated_at = NOW()
      WHERE ticket_number IN (?)
      `,
      [ticketNumbers],
    );

    res.json({
      success: true,
      message:
        ticketNumbers.length > 1
          ? `${ticketNumbers.length} shipments assigned successfully.`
          : "Shipment assigned successfully.",
      dispatch_id: dispatchId,
    });
  } catch (err) {
    console.error("========== ASSIGN ERROR ==========");
    console.error(err);

    try {
      if (driverReserved)
        await releaseDriver(req.body.driver_id, originalDriverStatus);
      if (vehicleReserved)
        await releaseVehicle(req.body.vehicle_id, originalVehicleStatus);
    } catch (rollbackErr) {
      console.error("========== ASSIGN ROLLBACK ERROR ==========");
      console.error(rollbackErr);
    }

    res.status(500).json({
      success: false,
      message: "Unable to assign shipment.",
    });
  }
});

// ======================================
// ROLLBACK HELPERS
// ======================================
// Both now accept the status to restore (defaulting to 'Available' for
// backwards compatibility with any other callers), instead of always
// hardcoding 'Available' — a driver reserved while in the 'Assigned'
// (home driver) state should be restored to 'Assigned', not bumped to
// 'Available' as a side effect of a failed dispatch attempt.
async function releaseDriver(driverId, restoreStatus = "Available") {
  await Update(
    `
    UPDATE drivers
    SET
        availability_status = ?,
        updated_at = NOW()
    WHERE id = ?
    `,
    [restoreStatus, driverId],
  );
}

async function releaseVehicle(vehicleId, restoreStatus = "Available") {
  await Update(
    `
    UPDATE vehicles
    SET
        status = ?,
        updated_at = NOW()
    WHERE id = ?
    `,
    [restoreStatus, vehicleId],
  );
}

/* ============================================================
   ON REAL TRANSACTIONS
   ============================================================
   The conditional UPDATE + manual rollback approach above closes the
   most likely race windows (double-booking a driver/vehicle) without
   needing to know how dbconnection.js manages connections. It is NOT
   equivalent to a real transaction: if the process crashes between the
   dispatch INSERT and the shipment status UPDATE, or between either of
   those and a rollback attempt, you can still end up with an
   inconsistent state that the manual rollback can't fix after the fact.

   If dbconnection.js exposes a way to grab a single connection (e.g. a
   mysql2 pool's `pool.getConnection()`), the more robust fix is to
   wrap this whole handler in:
     connection.beginTransaction() -> ...queries on that connection...
     -> connection.commit() / connection.rollback()
   Happy to wire that in properly once I can see how Select/Insert/
   Update/Delete are implemented.
   ============================================================ */

module.exports = router;
