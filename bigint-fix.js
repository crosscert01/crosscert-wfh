// Normalize PostgreSQL BIGINT identifiers to JavaScript numbers.
// During `npm install`, pg may not exist yet; skip safely and enable on runtime preload.
try {
  const { types } = require('pg');
  types.setTypeParser(20, value => Number(value));
  console.log('PostgreSQL BIGINT ID parser enabled');
} catch (e) {
  if (e && e.code !== 'MODULE_NOT_FOUND') throw e;
}
