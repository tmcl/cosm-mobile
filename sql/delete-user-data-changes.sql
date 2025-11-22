update user_data_changes set deleted_date = date() where id in (
    select value from json_each($ids)
    );