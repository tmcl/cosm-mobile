WITH bufferedways AS (SELECT *
                      FROM (SELECT id,
                                   -- sometimes SingleSidedBuffer does not work. using coalesce with no "else" branch means that whenever SSB fails, or when there is no oneway tag, we fall back on buffer.
                                   COALESCE(CASE properties ->> '$.tags.oneway'
                                                WHEN 'yes' THEN SingleSidedBuffer(geomgda, width, 1)
                                                WHEN '-1' THEN SingleSidedBuffer(geomgda, width, 0) END,
                                            buffer(geomgda, width / 2.0)) AS geombufferedgda
                            FROM ways
                            WHERE geombufferedgda IS NULL -- this checks the table
                              AND geomgda IS NOT NULL)
                      WHERE geombufferedgda IS NOT NULL -- this checks our attempt above. by doing this, we will have a certain number of failures and up to 15 successes
                      LIMIT 15)
UPDATE ways
SET geombufferedgda = bufferedways.geombufferedgda,
    geombuffered    = transform(bufferedways.geombufferedgda, 4326)
FROM bufferedways
WHERE bufferedways.id = ways.id
