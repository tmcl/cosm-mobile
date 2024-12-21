WITH RECURSIVE
    relatedways AS (
        SELECT
            *
        FROM
            (
                SELECT
                    id AS initiator,
                    jsonb_object (CAST(id AS text), 1) AS acc,
                    ways.*
                FROM
                    ways
                        LEFT JOIN ways_of_same_roads ON ways.id = way_id
                WHERE
                    way_id IS NULL
                LIMIT
                    100
            )
        UNION
        SELECT
            initiator,
            jsonb_patch (acc, jsonb_object (CAST(ways.id AS text), 1)) AS acc,
            ways.*
        FROM
            ways
                JOIN relatedways
                JOIN nodes_ways AS candidate_nodes_ways ON ways.id = candidate_nodes_ways.way_id
                JOIN nodes_ways AS known_nodes_ways ON relatedways.id = known_nodes_ways.way_id
                AND candidate_nodes_ways.node_id = known_nodes_ways.node_id
        WHERE
            ways.properties ->> '$.tags.name' = relatedways.properties ->> '$.tags.name'
          AND ways.properties ->> '$.tags.highway' = relatedways.properties ->> '$.tags.highway'
          AND acc -> ('$.' || CAST(ways.id AS text)) IS NULL
    )
INSERT INTO
    ways_of_same_roads (way_id, road)
SELECT
    initiator,
    JSON_GROUP_ARRAY(
            DISTINCT id
            ORDER BY
            id
    ) sameroad
FROM
    relatedways
GROUP BY
    initiator ;
