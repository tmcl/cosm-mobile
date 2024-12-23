SELECT JSON_GROUP_OBJECT(id, jsonb(intersections)) AS intersections
FROM (SELECT CAST(ways.id AS TEXT)                                 AS id,
             jsonb_group_array(jsonb_object('ix', n.key, 'others', nodes_ways.way_id, 'node_tags', nodes.properties,
                                            'way_tags',
                                            other_way.properties)) AS intersections
      FROM ways
               JOIN JSON_EACH(ways.nodes) n
               LEFT JOIN nodes_ways ON n.value = nodes_ways.node_id AND nodes_ways.way_id <> ways.id
               LEFT JOIN nodes ON nodes.id = nodes_ways.node_id
               LEFT JOIN ways AS other_way ON other_way.id = nodes_ways.way_id
      WHERE ways.id IN (SELECT CAST(atom AS number) FROM JSON_EACH($required_ids) WHERE atom IS NOT NULL)
      GROUP BY ways.id
      LIMIT 1000) query