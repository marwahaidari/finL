const express = require("express");
const router = express.Router();
const backupController = require("../controllers/backupController");
const checkRole = require("../middlewares/checkRole");

// فقط کاربران با نقش 'admin' می‌تونن بکاپ بگیرن و ریستور کنن
router.post(
    "/backup/database",
    checkRole({ roles: "admin", audit: true }),
    backupController.createDatabaseBackup
);

router.post(
    "/backup/files",
    checkRole({ roles: "admin", audit: true }),
    backupController.createFilesBackup
);

router.post(
    "/backup/restore",
    checkRole({ roles: "admin", audit: true }),
    backupController.restoreDatabase
);

router.get(
    "/backup/history",
    checkRole({ roles: ["admin", "supervisor"], audit: true }),
    backupController.getBackupHistory
);

module.exports = router;
