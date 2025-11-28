SELECT id, type, json(state_extract) as state_extract, change, created_date, modified_date, ready_date, commit_date
FROM user_data_changes
WHERE ready_date IS NULL and deleted_date is null
ORDER BY id DESC
LIMIT 100