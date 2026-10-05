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
  res.render("shipmentPlanning", { title: "Express" });
});

router.put("/shipment-planning/:id/approve", async (req, res) => {
  const id = req.params.id;

  await db.query(
    `
    UPDATE shipment_planning
    SET status = 'Approved',
        approved_by = ?,
        approved_at = NOW()
    WHERE id = ? AND status = 'Draft'
  `,
    [req.user.id, id],
  );

  res.json({ message: "Approved" });
});

router.get("/shipment-planning/:id", async (req, res) => {
  const id = req.params.id;

  const header = await db.query(
    "SELECT * FROM shipment_planning WHERE id = ?",
    [id],
  );

  const items = await db.query(
    `SELECT * FROM shipment_planning_items WHERE planning_id = ?`,
    [id],
  );

  if (!header.length) {
    return res.status(404).json({ message: "Not found" });
  }

  res.json({
    data: {
      ...header[0],
      items,
    },
  });
});

router.put("/shipment-planning/:id", async (req, res) => {
  const id = req.params.id;

  const planning = await db.query(
    "SELECT status FROM shipment_planning WHERE id = ?",
    [id],
  );

  if (!planning.length) {
    return res.status(404).json({ message: "Not found" });
  }

  if (planning[0].status !== "Draft") {
    return res.status(403).json({
      message: "Only Draft planning can be edited",
    });
  }

  // update header
  await db.query(
    `UPDATE shipment_planning
     SET planning_date = ?, remarks = ?, status = ?
     WHERE id = ?`,
    [req.body.planning_date, req.body.remarks, req.body.status, id],
  );

  // delete old items
  await db.query("DELETE FROM shipment_planning_items WHERE planning_id = ?", [
    id,
  ]);

  // insert new items
  for (const item of req.body.items) {
    await db.query(
      `INSERT INTO shipment_planning_items
      (planning_id, type_id, product_id, unit_id, requested_qty, planned_qty)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        item.type_id,
        item.product_id,
        item.unit_id,
        item.requested_qty,
        item.planned_qty,
      ],
    );
  }

  res.json({ message: "Updated successfully" });
});

router.put("/shipment-planning/:id/approve", async (req, res) => {
  const id = req.params.id;

  await db.query(
    `UPDATE shipment_planning
     SET status = 'Approved',
         approved_by = ?,
         approved_at = NOW()
     WHERE id = ? AND status = 'Draft'`,
    [req.user.id, id],
  );

  res.json({ message: "Approved" });
});

router.put("/shipment-planning/:id/lock", async (req, res) => {
  const id = req.params.id;

  await db.query(
    `UPDATE shipment_planning
     SET status = 'Locked',
         locked_by = ?,
         locked_at = NOW()
     WHERE id = ? AND status = 'Approved'`,
    [req.user.id, id],
  );

  res.json({ message: "Locked" });
});

module.exports = router;
