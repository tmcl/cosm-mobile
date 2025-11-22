SELECT *
FROM user_data_changes
WHERE ready_date IS NULL and deleted_date is null
ORDER BY id DESC
LIMIT 100