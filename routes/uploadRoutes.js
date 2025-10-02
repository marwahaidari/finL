const express = require("express");
const router = express.Router();
const { uploadProfile, uploadDocument, uploadMultipleImages } = require("../utils/upload");

// آپلود پروفایل
router.post("/upload/profile", uploadProfile, (req, res) => {
    res.json({ msg: "پروفایل آپلود شد", file: req.file });
});

// آپلود سند
router.post("/upload/document", uploadDocument, (req, res) => {
    res.json({ msg: "سند آپلود شد", file: req.file });
});

// آپلود چند عکس
router.post("/upload/images", uploadMultipleImages, (req, res) => {
    res.json({ msg: "چند عکس آپلود شد", files: req.files });
});

module.exports = router;
