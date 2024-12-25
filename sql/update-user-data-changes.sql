Update user_data_changes
    set
        type = $type,
        state_extract = jsonb($state_extract),
        change = jsonb($change),
        modified_date = UNIXEPOCH()
where id = $id and ready_date is null and commit_date is null