// config/settings.js
module.exports = {
    server: {

        port: process.env.PORT

    },
    security: {
        maxLoginAttempts: 5,
        lockTime: 10 * 60 * 1000
    },
    upload: {
        maxFileSize: 5 * 1024 * 1024,
        allowedFileTypes: ['image/jpeg', 'image/png', 'application/pdf']
    }
};
