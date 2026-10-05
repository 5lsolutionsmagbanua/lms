const { Insert } = require("./dbconnection");

/* =====================================================
   HISTORY LOGGER — shared by shipmentTracking.js and
   driverDashboard.js. Writes one row per status transition
   into shipment_tracking_history, always stamping the real
   time of the transition (NOW()) rather than relying on the
   column's DEFAULT, so every milestone has a real timestamp
   regardless of which surface (admin tracking page or driver
   app) made the change.

   Both callers pass the SAME shape:
     ticket_number     - required
     tracking_row_id   - shipment_dispatch_items.id (nullable
                          for legacy callers, but both current
                          callers always have it)
     from_status       - status before the change (nullable for
                          the very first transition on a ticket)
     to_status          - required, the new status
     remarks            - optional
     proof_photo_path   - optional, JSON string or single path
     changed_by         - optional, from getChangedBy(req)
===================================================== */
async function logTrackingHistory({
  ticket_number,
  tracking_row_id = null,
  from_status = null,
  to_status,
  remarks = null,
  proof_photo_path = null,
  changed_by = null,
}) {
  await Insert(
    `INSERT INTO shipment_tracking_history
       (ticket_number, tracking_row_id, from_status, to_status, remarks, proof_photo_path, changed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      ticket_number,
      tracking_row_id,
      from_status,
      to_status,
      remarks,
      proof_photo_path,
      changed_by,
    ],
  );
}

module.exports = { logTrackingHistory };
