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
