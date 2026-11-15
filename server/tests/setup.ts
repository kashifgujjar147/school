// Environment for tests. Must be set before any app module is imported.
process.env.NODE_ENV = 'test';
process.env.APP_MODE = 'hybrid';
process.env.SCHOOL_INSTALL_ID = 'test-school';
process.env.NODE_ID = 'test-local';
process.env.PACKAGE = 'standard';
process.env.MONGODB_URI = 'mongodb://placeholder-set-by-tests:27017';
process.env.MONGODB_DB_NAME = 'sms_test';
process.env.ATLAS_SYNC_URI = 'mongodb://placeholder-set-by-tests:27017';
process.env.ATLAS_SYNC_DB_NAME = 'sms_test_atlas';
process.env.SESSION_SECRET = 'a'.repeat(64);
process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(64);
process.env.APP_URL = 'http://localhost:8080';
process.env.LOG_LEVEL = 'silent';
process.env.UPLOAD_DIR = './.test-data/uploads';
process.env.BACKUP_DIR = './.test-data/backups';
process.env.SMS_PROVIDER = 'none';
// The developer's server/.env is also loaded (dotenv does not override variables set here), so every
// flag that changes request handling is pinned: a production .env with COOKIE_SECURE=true would make
// the test agent drop the session cookie over plain HTTP.
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = '0';
process.env.CORS_ORIGINS = '';
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';
process.env.PAYMENT_PROVIDER = 'none';
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';
