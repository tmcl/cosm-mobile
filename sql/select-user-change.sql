SELECT id, type, json(state_extract) as state_extract, json(change) as change, created_date, modified_date, ready_date, commit_date
FROM user_data_changes
WHERE id = $id
