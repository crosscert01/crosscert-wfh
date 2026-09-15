// Normalize PostgreSQL BIGINT identifiers to JavaScript numbers.
// CROSSCERT WFH IDs are well within Number.MAX_SAFE_INTEGER.
const { types } = require('pg');
types.setTypeParser(20, value => Number(value));
console.log('PostgreSQL BIGINT ID parser enabled');
