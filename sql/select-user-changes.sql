SELECT *
FROM user_data_changes
WHERE ready_date IS NULL
ORDER BY id DESC
LIMIT 100