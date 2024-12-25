INSERT INTO user_data_changes (type, state_extract, change, created_date)
VALUES ($type, jsonb($state_extract), jsonb($change), UNIXEPOCH())
returning *