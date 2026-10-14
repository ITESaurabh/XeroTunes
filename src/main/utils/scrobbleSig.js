/* eslint-disable @typescript-eslint/no-var-requires */
const crypto = require('crypto');

/**
 * Last.fm request signature: every parameter except `format` and `api_sig`,
 * sorted by name, concatenated as name+value, with the shared secret appended,
 * then md5'd. Get any part of that wrong and the API answers "invalid method
 * signature" for every call, so it lives here with a test.
 */
function lastfmSignature(params, secret) {
  const base = Object.keys(params)
    .filter(k => k !== 'format' && k !== 'api_sig')
    .sort()
    .map(k => k + params[k])
    .join('');
  return crypto
    .createHash('md5')
    .update(base + secret, 'utf8')
    .digest('hex');
}

module.exports = { lastfmSignature };
