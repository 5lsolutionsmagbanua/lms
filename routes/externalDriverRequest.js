const express = require("express");
const router = express.Router();
const { randomUUID } = require("crypto");

const {
  Select,
  Update,
  Insert,
  Delete,
} = require("../repository/dbconnection");

const requireApiKey = require("../middleware/apiKey");

/*
|--------------------------------------------------------------------------
| GET DRIVER REQUESTS
|--------------------------------------------------------------------------
| GET /api/external/driver-request
|
| Requires:
| x-api-key
|--------------------------------------------------------------------------
*/
router.get("/driver-request", requireApiKey, async (req, res) => {
  try {
    const requests = await Select(
      `
      SELECT
        dr_id,
        dr_requestId,
        dr_storeId,
        dr_ticketNumber,
        dr_storeName,
        dr_storeCode,
        dr_requestType,
        dr_itemName,
        dr_asset,
        dr_serial,
        dr_requestQty,
        dr_notes,
        dr_status,
        dr_createdDate,
        dr_createdBy
      FROM driver_request
      ORDER BY dr_createdDate DESC
      `,
    );

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error("GET driver request error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve driver requests.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET SINGLE DRIVER REQUEST
|--------------------------------------------------------------------------
| GET /api/external/driver-request/:requestId
|--------------------------------------------------------------------------
*/
router.get("/driver-request/:requestId", requireApiKey, async (req, res) => {
  try {
    const { requestId } = req.params;

    const requests = await Select(
      `
        SELECT
          dr_id,
          dr_requestId,
          dr_storeId,
          dr_ticketNumber,
          dr_storeName,
          dr_storeCode,
          dr_requestType,
          dr_itemName,
          dr_asset,
          dr_serial,
          dr_requestQty,
          dr_notes,
          dr_status,
          dr_createdDate,
          dr_createdBy
        FROM driver_request
        WHERE dr_requestId = ?
        LIMIT 1
        `,
      [requestId],
    );

    if (!requests || requests.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Driver request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: requests[0],
    });
  } catch (error) {
    console.error("GET single driver request error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve driver request.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| CREATE DRIVER REQUEST
|--------------------------------------------------------------------------
| POST /api/external/driver-request
|--------------------------------------------------------------------------
*/
router.post("/driver-request", requireApiKey, async (req, res) => {
  console.log("=================================");
  console.log("EXTERNAL DRIVER REQUEST");
  console.log("Method:", req.method);
  console.log("URL:", req.originalUrl);
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("API Key Provided:", !!req.headers["x-api-key"]);
  console.log("Body:", req.body);
  console.log("=================================");

  try {
    const {
      dr_requestId,
      dr_storeId,
      dr_ticketNumber,
      dr_storeName,
      dr_storeCode,
      dr_requestType,
      dr_itemName,
      dr_asset,
      dr_serial,
      dr_requestQty,
      dr_notes,
      dr_status,
      dr_createdDate,
      dr_createdBy,
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | Required validation
    |--------------------------------------------------------------------------
    */

    const requiredFields = {
      dr_requestId,
      dr_storeId,
      dr_ticketNumber,
      dr_storeName,
      dr_storeCode,
      dr_requestType,
      dr_itemName,
      dr_requestQty,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(
        ([_, value]) => value === undefined || value === null || value === "",
      )
      .map(([field]) => field);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields.",
        missingFields,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Validate quantity
    |--------------------------------------------------------------------------
    */

    const quantity = Number(dr_requestQty);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "dr_requestQty must be a positive integer.",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Check duplicate request ID
    |--------------------------------------------------------------------------
    */

    const existingRequest = await Select(
      `
      SELECT
        dr_id,
        dr_requestId,
        dr_ticketNumber,
        dr_status
      FROM driver_request
      WHERE dr_requestId = ?
      LIMIT 1
      `,
      [dr_requestId],
    );

    if (existingRequest.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Driver request already exists.",
        data: existingRequest[0],
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Generate UUID
    |--------------------------------------------------------------------------
    */

    const dr_id = uuidv4();

    /*
    |--------------------------------------------------------------------------
    | Insert
    |--------------------------------------------------------------------------
    */

    await Insert(
      `
      INSERT INTO driver_request (
        dr_id,
        dr_requestId,
        dr_storeId,
        dr_ticketNumber,
        dr_storeName,
        dr_storeCode,
        dr_requestType,
        dr_itemName,
        dr_asset,
        dr_serial,
        dr_requestQty,
        dr_notes,
        dr_status,
        dr_createdDate,
        dr_createdBy
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        dr_id,
        dr_requestId,
        dr_storeId,
        dr_ticketNumber,
        dr_storeName,
        dr_storeCode,
        dr_requestType,
        dr_itemName,
        dr_asset || null,
        dr_serial || null,
        quantity,
        dr_notes || null,
        dr_status || "Pending",
        dr_createdDate || new Date(),
        dr_createdBy || "External API",
      ],
    );

    /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

    return res.status(201).json({
      success: true,
      message: "Driver request created successfully.",
      data: {
        dr_id,
        dr_requestId,
        dr_ticketNumber,
        dr_status: dr_status || "Pending",
      },
    });
  } catch (error) {
    console.error("POST driver request error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create driver request.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| UPDATE DRIVER REQUEST STATUS
|--------------------------------------------------------------------------
| PUT /api/external/driver-request/:requestId/status
|--------------------------------------------------------------------------
*/
router.put(
  "/driver-request/:requestId/status",
  requireApiKey,
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const { dr_status } = req.body;

      if (!dr_status) {
        return res.status(400).json({
          success: false,
          message: "dr_status is required.",
        });
      }

      const existingRequest = await Select(
        `
        SELECT dr_id, dr_requestId
        FROM driver_request
        WHERE dr_requestId = ?
        LIMIT 1
        `,
        [requestId],
      );

      if (existingRequest.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Driver request not found.",
        });
      }

      await Update(
        `
        UPDATE driver_request
        SET dr_status = ?
        WHERE dr_requestId = ?
        `,
        [dr_status, requestId],
      );

      return res.status(200).json({
        success: true,
        message: "Driver request status updated successfully.",
        data: {
          dr_requestId: requestId,
          dr_status,
        },
      });
    } catch (error) {
      console.error("UPDATE driver request status error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update driver request status.",
      });
    }
  },
);

module.exports = router;
