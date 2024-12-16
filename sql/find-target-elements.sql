with 
  tagmatchingnodes as (select nodes.rowid matchingrowid, count(1) as count
  from nodes
  join json_each($needle) needle
  join json_each(jsonb_extract(properties, '$.tags')) haystack on needle.fullkey = haystack.fullkey and needle.value = haystack.value
  group by nodes.rowid
  having count = $needleLength)
select nodes.id, nodes.observed, nodes.version, 
    json_object(
        'type', 'Feature',
        'id', cast(nodes.id as text),
        'geometry', json(asgeojson(geom)),
        'properties', json(jsonb_set(properties, '$.ways', jsonb_group_array(cast(nodes_ways.way_id as text))))
    ) as geojson
  from nodes
  join tagmatchingnodes on tagmatchingnodes.matchingrowid = nodes.rowid
  join nodes_ways on nodes.id = nodes_ways.node_id
  where st_EnvelopesIntersects(geom, $minlon, $minlat, $maxlon, $maxlat)
  group by nodes.id
limit 100