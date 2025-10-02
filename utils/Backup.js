// utils/Backup.js
// Full-featured backup utility for E-Government portal
// Features: pg_dump/pg_restore, zip files, AES-256-GCM encryption, SHA256 integrity, upload S3/FTP,
// retention cleanup, DB logging, email/webhook notifications, scheduled jobs.

// Required packages (install them):
// npm i uuid archiver unzipper node-schedule aws-sdk nodemailer basic-ftp dotenv

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const unzipper = require('unzipper');
const schedule = require('node-schedule');
const AWS = require('aws-sdk'); // aws-sdk v2
const nodemailer = require('nodemailer');
const ftp = require('basic-ftp');

// assume you have a PostgreSQL pool at ../db (exports query)
const pool = require('../db');

// Configuration via ENV
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const DB_USER = process.env.DB_USER;
const DB_NAME = process.env.DB_NAME;
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 5432;
const DB_PASSWORD = process.env.DB_PASSWORD;

const AES_KEY_B64 = process.env.BACKUP_ENCRYPTION_KEY || null; // base64 32 bytes
const AES_KEY = AES_KEY_B64 ? Buffer.from(AES_KEY_B64, 'base64') : null;

const AWS_S3_ENABLED = !!process.env.S3_BUCKET && !!process.env.AWS_ACCESS_KEY_ID;
if (AWS_S3_ENABLED) {
    AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
    });
}
const S3_BUCKET = process.env.S3_BUCKET;

const SMTP_CONFIG = {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
};

const DEFAULT_RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);

class Backup {
    // ---------- helpers ----------
    static sha256File(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('error', reject);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }

    // AES-256-GCM encrypt file (stream-friendly)
    static async encryptFile(inputPath, outputPath) {
        if (!AES_KEY) throw new Error('No BACKUP_ENCRYPTION_KEY set in env (base64 32 bytes)');
        const iv = crypto.randomBytes(12); // 96-bit for GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
        return new Promise((resolve, reject) => {
            const input = fs.createReadStream(inputPath);
            const output = fs.createWriteStream(outputPath);
            output.write(iv); // prefix IV
            input.pipe(cipher).pipe(output);
            output.on('finish', () => {
                const tag = cipher.getAuthTag();
                fs.appendFileSync(outputPath, tag); // append auth tag at EOF
                resolve();
            });
            output.on('error', reject);
            input.on('error', reject);
        });
    }

    // Decrypt file produced by encryptFile
    static async decryptFile(inputPath, outputPath) {
        if (!AES_KEY) throw new Error('No BACKUP_ENCRYPTION_KEY set in env (base64 32 bytes)');
        const stat = fs.statSync(inputPath);
        const total = stat.size;
        // IV is first 12 bytes, tag is last 16 bytes
        const iv = Buffer.alloc(12);
        const tag = Buffer.alloc(16);

        const fd = fs.openSync(inputPath, 'r');
        fs.readSync(fd, iv, 0, 12, 0);
        fs.readSync(fd, tag, 0, 16, total - 16);
        fs.closeSync(fd);

        const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, iv);
        decipher.setAuthTag(tag);

        // create read stream from offset 12 to total-16
        return new Promise((resolve, reject) => {
            const input = fs.createReadStream(inputPath, { start: 12, end: total - 17 }); // end is inclusive
            const output = fs.createWriteStream(outputPath);
            input.pipe(decipher).pipe(output);
            output.on('finish', resolve);
            output.on('error', reject);
            input.on('error', reject);
        });
    }

    // zip folders -> filepath
    static zipFolders(folders, outPath) {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(outPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', () => resolve());
            archive.on('error', err => reject(err));
            archive.pipe(output);
            for (const f of folders) {
                const abs = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
                if (!fs.existsSync(abs)) continue;
                const stats = fs.statSync(abs);
                if (stats.isDirectory()) archive.directory(abs, path.basename(abs));
                else archive.file(abs, { name: path.basename(abs) });
            }
            archive.finalize();
        });
    }

    // upload to S3
    static async uploadToS3(localPath, remoteKey) {
        if (!AWS_S3_ENABLED) throw new Error('S3 not configured');
        const s3 = new AWS.S3();
        const data = fs.createReadStream(localPath);
        const params = { Bucket: S3_BUCKET, Key: remoteKey, Body: data };
        return new Promise((resolve, reject) => {
            s3.upload(params, (err, res) => {
                if (err) return reject(err);
                resolve(res);
            });
        });
    }

    // upload to FTP
    static async uploadToFTP(localPath, remotePath) {
        const client = new ftp.Client(30_000);
        client.ftp.verbose = false;
        try {
            await client.access({
                host: process.env.FTP_HOST,
                user: process.env.FTP_USER,
                password: process.env.FTP_PASS,
                secure: process.env.FTP_SECURE === 'true'
            });
            await client.ensureDir(path.dirname(remotePath));
            await client.uploadFrom(localPath, remotePath);
            await client.close();
            return { ok: true, remotePath };
        } catch (err) {
            client.close().catch(() => { });
            throw err;
        }
    }

    // send email notification
    static async notifyAdmin(subject, text, attachments = []) {
        if (!SMTP_CONFIG.host) return;
        try {
            const transporter = nodemailer.createTransport(SMTP_CONFIG);
            const mailOptions = {
                from: SMTP_CONFIG.auth.user,
                to: process.env.BACKUP_NOTIFY_EMAILS || SMTP_CONFIG.auth.user,
                subject,
                text,
                attachments
            };
            await transporter.sendMail(mailOptions);
        } catch (err) {
            console.error('notifyAdmin error', err);
        }
    }

    // log to DB (backup_history)
    static async logHistory(type, filepath, meta = {}) {
        try {
            const id = uuidv4();
            const checksum = meta.checksum || null;
            const uploaded_to = meta.uploaded_to || null;
            await pool.query(
                `INSERT INTO backup_history (id, type, file_path, checksum, uploaded_to, meta, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [id, type, filepath, checksum, uploaded_to, meta]
            );
            return id;
        } catch (err) {
            console.error('Failed to log backup history:', err);
            // do not throw to avoid breaking backup flow
        }
    }

    // ---------- main methods ----------
    // Backup database (pg_dump -F c)
    static async backupDatabase(filename = null, opts = {}) {
        const file = filename || `db_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.dump`;
        const filepath = path.join(BACKUP_DIR, file);
        const dbUser = DB_USER;
        const dbName = DB_NAME;
        const dbHost = DB_HOST;
        const dbPort = DB_PORT;
        const password = DB_PASSWORD;

        const envPrefix = process.platform === 'win32' ? '' : `PGPASSWORD='${password}' `;

        const cmd = `${envPrefix}pg_dump -U ${dbUser} -h ${dbHost} -p ${dbPort} -F c -b -v -f "${filepath}" ${dbName}`;
        return new Promise((resolve, reject) => {
            exec(cmd, async (err, stdout, stderr) => {
                if (err) {
                    await Backup.notifyAdmin('Backup failed: DB', `pg_dump error: ${err.message}\n${stderr}`);
                    return reject(err);
                }
                try {
                    const checksum = await Backup.sha256File(filepath);
                    let finalPath = filepath;
                    // encryption if requested
                    if (opts.encrypt) {
                        const encPath = `${filepath}.enc`;
                        await Backup.encryptFile(filepath, encPath);
                        fs.unlinkSync(filepath);
                        finalPath = encPath;
                    }
                    // upload
                    let uploaded_to = null;
                    if (opts.s3 && AWS_S3_ENABLED) {
                        const key = `backups/${path.basename(finalPath)}`;
                        const s3res = await Backup.uploadToS3(finalPath, key);
                        uploaded_to = `s3:${s3res.Location || key}`;
                    } else if (opts.ftp && process.env.FTP_HOST) {
                        const remotePath = `${process.env.FTP_PATH || '/'}${path.basename(finalPath)}`;
                        await Backup.uploadToFTP(finalPath, remotePath);
                        uploaded_to = `ftp:${remotePath}`;
                    }
                    await Backup.logHistory('database', finalPath, { checksum, uploaded_to, options: opts });
                    await Backup.notifyAdmin('DB backup success', `Database backup created: ${finalPath}\nchecksum: ${checksum}`);
                    resolve({ file: finalPath, checksum, uploaded_to });
                } catch (e) {
                    await Backup.notifyAdmin('Backup failed (post-process)', `Error: ${e.message}`);
                    reject(e);
                }
            });
        });
    }

    // Backup files (zip)
    static async backupFiles(folders = [], filename = null, opts = {}) {
        if (!Array.isArray(folders) || folders.length === 0) throw new Error('folders array required');
        const file = filename || `files_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        const filepath = path.join(BACKUP_DIR, file);
        try {
            await Backup.zipFolders(folders, filepath);
            const checksum = await Backup.sha256File(filepath);
            let finalPath = filepath;
            if (opts.encrypt) {
                const encPath = `${filepath}.enc`;
                await Backup.encryptFile(filepath, encPath);
                fs.unlinkSync(filepath);
                finalPath = encPath;
            }
            let uploaded_to = null;
            if (opts.s3 && AWS_S3_ENABLED) {
                const key = `backups/${path.basename(finalPath)}`;
                const s3res = await Backup.uploadToS3(finalPath, key);
                uploaded_to = `s3:${s3res.Location || key}`;
            } else if (opts.ftp && process.env.FTP_HOST) {
                const remotePath = `${process.env.FTP_PATH || '/'}${path.basename(finalPath)}`;
                await Backup.uploadToFTP(finalPath, remotePath);
                uploaded_to = `ftp:${remotePath}`;
            }
            await Backup.logHistory('files', finalPath, { checksum, uploaded_to, folders, options: opts });
            await Backup.notifyAdmin('Files backup success', `Files backup created: ${finalPath}\nchecksum: ${checksum}`);
            return { file: finalPath, checksum, uploaded_to };
        } catch (err) {
            await Backup.notifyAdmin('Files backup failed', `Error: ${err.message}`);
            throw err;
        }
    }

    // Restore DB from backup file (if encrypted, decrypt first)
    static async restoreDatabase(filepath, opts = {}) {
        if (!fs.existsSync(filepath)) throw new Error('Backup file not found');
        let toUse = filepath;
        let tempDecrypted = null;
        try {
            // if .enc -> decrypt to temp
            if (path.extname(filepath) === '.enc') {
                tempDecrypted = `${filepath}.dec`;
                await Backup.decryptFile(filepath, tempDecrypted);
                toUse = tempDecrypted;
            }
            const dbUser = DB_USER;
            const dbName = DB_NAME;
            const dbHost = DB_HOST;
            const dbPort = DB_PORT;
            const password = DB_PASSWORD;
            const envPrefix = process.platform === 'win32' ? '' : `PGPASSWORD='${password}' `;
            // simple full restore
            const cmd = `${envPrefix}pg_restore -U ${dbUser} -h ${dbHost} -p ${dbPort} -d ${dbName} -c "${toUse}"`;
            return new Promise((resolve, reject) => {
                exec(cmd, async (err, stdout, stderr) => {
                    if (tempDecrypted && fs.existsSync(tempDecrypted)) fs.unlinkSync(tempDecrypted);
                    if (err) {
                        await Backup.notifyAdmin('DB restore failed', `pg_restore error: ${err.message}\n${stderr}`);
                        return reject(err);
                    }
                    await Backup.logHistory('database_restore', filepath, { options: opts });
                    await Backup.notifyAdmin('DB restore success', `Database restored from: ${filepath}`);
                    resolve({ ok: true });
                });
            });
        } catch (err) {
            if (tempDecrypted && fs.existsSync(tempDecrypted)) fs.unlinkSync(tempDecrypted);
            throw err;
        }
    }

    // Restore files: if encrypted decrypt, then unzip selected or full
    static async restoreFiles(archivePath, destFolder, opts = {}) {
        if (!fs.existsSync(archivePath)) throw new Error('Archive not found');
        let toUse = archivePath;
        const tempDecrypted = `${archivePath}.dec`;
        try {
            if (path.extname(archivePath) === '.enc') {
                await Backup.decryptFile(archivePath, tempDecrypted);
                toUse = tempDecrypted;
            }
            // if opts.files provided -> extract only those entries
            const directory = await unzipper.Open.file(toUse);
            if (Array.isArray(opts.files) && opts.files.length > 0) {
                for (const entryName of opts.files) {
                    const entry = directory.files.find(f => f.path === entryName);
                    if (!entry) continue;
                    const writePath = path.join(destFolder, entry.path);
                    await entry.stream().pipe(fs.createWriteStream(writePath));
                }
            } else {
                // extract all
                await directory.extract({ path: destFolder, concurrency: 5 });
            }
            if (toUse === tempDecrypted && fs.existsSync(tempDecrypted)) fs.unlinkSync(tempDecrypted);
            await Backup.logHistory('files_restore', archivePath, { destFolder, options: opts });
            await Backup.notifyAdmin('Files restore success', `Files restored from ${archivePath} to ${destFolder}`);
            return { ok: true };
        } catch (err) {
            if (fs.existsSync(tempDecrypted)) fs.unlinkSync(tempDecrypted);
            await Backup.notifyAdmin('Files restore failed', `Error: ${err.message}`);
            throw err;
        }
    }

    // Fetch backups ready to be pushed (e.g., scheduled)
    static async fetchReadyForPush() {
        // fallback: list local BACKUP_DIR files by date
        const files = fs.readdirSync(BACKUP_DIR).map(f => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }));
        files.sort((a, b) => b.mtime - a.mtime);
        return files;
    }

    // Retention cleanup - delete backups older than days
    static async cleanOldBackups(days = DEFAULT_RETENTION_DAYS) {
        const cutoff = Date.now() - days * 24 * 3600 * 1000;
        const files = fs.readdirSync(BACKUP_DIR);
        let removed = [];
        for (const f of files) {
            const full = path.join(BACKUP_DIR, f);
            const stat = fs.statSync(full);
            if (stat.mtime.getTime() < cutoff) {
                try {
                    fs.unlinkSync(full);
                    removed.push(full);
                } catch (e) {
                    console.error('Failed remove:', full, e);
                }
            }
        }
        if (removed.length) {
            await Backup.logHistory('retention_cleanup', null, { removed });
        }
        return removed;
    }

    // scheduledBackup reading schedule from DB or env
    static async scheduledBackup() {
        try {
            // read schedule settings from DB if exists (table: backup_settings with columns cron, options JSON)
            let scheduleRule = process.env.BACKUP_CRON || null;
            let options = { encrypt: true, s3: !!AWS_S3_ENABLED };
            try {
                const r = await pool.query('SELECT cron, options FROM backup_settings ORDER BY created_at DESC LIMIT 1');
                if (r.rows?.[0]?.cron) scheduleRule = r.rows[0].cron;
                if (r.rows?.[0]?.options) options = { ...options, ...r.rows[0].options };
            } catch (e) {
                // ignore if table missing
            }

            if (!scheduleRule) {
                // default: every day at 02:00
                scheduleRule = process.env.BACKUP_CRON || '0 2 * * *';
            }

            // node-schedule uses object or string? it supports cron-like via schedule.scheduleJob with string as well
            schedule.scheduleJob(scheduleRule, async () => {
                console.log('Scheduled backup triggered at', new Date().toISOString());
                try {
                    await Backup.backupDatabase(null, options);
                    // backup uploads folder as default
                    await Backup.backupFiles(['uploads', 'documents'], null, options);
                    await Backup.cleanOldBackups(parseInt(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS, 10));
                } catch (err) {
                    console.error('Scheduled backup error:', err);
                    await Backup.notifyAdmin('Scheduled backup failed', String(err));
                }
            });

            return { cron: scheduleRule, options };
        } catch (err) {
            console.error('scheduledBackup setup failed', err);
            throw err;
        }
    }

    // list history (from DB)
    static async getHistory(limit = 50, offset = 0) {
        try {
            const r = await pool.query(`SELECT * FROM backup_history ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
            return r.rows;
        } catch (err) {
            console.error('getHistory error', err);
            return [];
        }
    }
}

module.exports = Backup;
