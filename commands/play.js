// Keep .music and .play on the same reliable downloader implementation.
// The old .play handler used a single obsolete endpoint and did not encode
// YouTube URLs, which caused frequent failed downloads.
module.exports = require('./song');