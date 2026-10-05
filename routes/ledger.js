var express = require("express");
var router = express.Router();

const {
  Select,
  Insert,
  Update,
  Delete,
} = require("../repository/dbconnection");

/* GET page */
router.get("/", function (req, res, next) {
  res.render("ledger", { title: "Ledger Page" });
});

// ======================================================
// TRANSACTION TYPES MODULE
// ======================================================

/**
 * GET ALL TRANSACTION TYPES
 */
router.get("/get-transaction-types", async (req, res) => {
  try {
    const result = await Select(`
      SELECT *
      FROM transaction_types
      ORDER BY id DESC
    `);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("[TRANSACTION TYPES] GET ALL ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction types",
    });
  }
});

/**
 * GET TRANSACTION TYPE BY ID
 */
router.get("/get-transaction-type/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await Select(
      `
      SELECT *
      FROM transaction_types
      WHERE id = ?
    `,
      [id],
    );

    if (!result.length) {
      return res.status(404).json({
        success: false,
        message: "Transaction type not found",
      });
    }

    res.status(200).json({
      success: true,
      data: result[0],
    });
  } catch (err) {
    console.error("[TRANSACTION TYPES] GET BY ID ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction type",
    });
  }
});

/**
 * ADD TRANSACTION TYPE
 */
router.post("/add-transaction-type", async (req, res) => {
  try {
    const { transaction_type_name, code, description, direction, created_by } =
      req.body;

    if (!transaction_type_name || !code || !created_by) {
      return res.status(400).json({
        success: false,
        message: "Transaction Type Name, Code and Created By are required",
      });
    }

    // Check duplicate code
    const existing = await Select(
      `
      SELECT id
      FROM transaction_types
      WHERE code = ?
    `,
      [code],
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: "Code already exists",
      });
    }

    const result = await Insert(
      `
      INSERT INTO transaction_types (
        transaction_type_name,
        code,
        description,
        direction,
        created_by,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, NOW())
    `,
      [
        transaction_type_name,
        code,
        description || null,
        direction || "none",
        created_by,
      ],
    );

    res.status(201).json({
      success: true,
      message: "Transaction type created successfully",
      insertId: result.insertId,
    });
  } catch (err) {
    console.error("[TRANSACTION TYPES] ADD ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Failed to create transaction type",
    });
  }
});

/**
 * UPDATE TRANSACTION TYPE
 */
router.put("/update-transaction-type", async (req, res) => {
  try {
    const { id, transaction_type_name, code, description, direction } =
      req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID is required",
      });
    }

    // Check duplicate code excluding current record
    const existing = await Select(
      `
      SELECT id
      FROM transaction_types
      WHERE code = ?
      AND id <> ?
    `,
      [code, id],
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: "Code already exists",
      });
    }

    const result = await Update(
      `
      UPDATE transaction_types
      SET
        transaction_type_name = ?,
        code = ?,
        description = ?,
        direction = ?
      WHERE id = ?
    `,
      [transaction_type_name, code, description, direction, id],
    );

    res.status(200).json({
      success: true,
      message: "Transaction type updated successfully",
      result,
    });
  } catch (err) {
    console.error("[TRANSACTION TYPES] UPDATE ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Failed to update transaction type",
    });
  }
});

/**
 * DELETE TRANSACTION TYPE
 */
router.delete("/delete-transaction-type/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await Delete(
      `
      DELETE FROM transaction_types
      WHERE id = ?
    `,
      [id],
    );

    res.status(200).json({
      success: true,
      message: "Transaction type deleted successfully",
      result,
    });
  } catch (err) {
    console.error("[TRANSACTION TYPES] DELETE ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Failed to delete transaction type",
    });
  }
});

module.exports = router;
