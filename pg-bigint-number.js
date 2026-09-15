// Normalize PostgreSQL int8/BIGINT identifiers to JavaScript numbers.
// IDs in this application are small sequence values and remain safely below Number.MAX_SAFE_INTEGER.
const pg=require('pg');
pg.types.setTypeParser(20, value => Number(value));
